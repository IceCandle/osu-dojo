import 'dotenv/config';
import BanchoJs from 'bancho.js';
import { BotClient } from './client';
import { MultiplayerManager } from './multiplayer';
import { findZombieLobbies, reconcileMatchHistory, checkStuckLobbies } from './recovery';
import { registerCommands } from './commands';
import { dequeueAttempt, enqueueAttempt } from '../lib/redis';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { MatchGenerator } from '../lib/match-generator';

/**
 * Bot entry point
 * Usage: npm run bot
 */

const USERNAME = (process.env.OSU_IRC_USERNAME ?? '').trim();
const PASSWORD = (process.env.OSU_IRC_PASSWORD ?? '').trim();
const API_KEY = (process.env.OSU_API_KEY ?? '').trim();

// Track active multiplayer managers for cleanup
const activeManagers = new Set<MultiplayerManager>();

// Create logger for bot component
const logger = createLogger('Bot');

// Match generator service
const matchGenerator = new MatchGenerator();

/**
 * Process a queued attempt
 * Generates the map order (static shuffle) and runs the lobby
 */
async function processAttempt(
  bot: BotClient,
  attemptId: number,
  managers: Set<MultiplayerManager>,
): Promise<void> {
  logger.info('Processing attempt', { attemptId });

  try {
    // Fetch attempt with related data
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        dan: {
          include: {
            beatmaps: {
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
        user: true,
      },
    });

    if (!attempt) {
      logger.error('Attempt not found', { attemptId });
      return;
    }

    const { dan, user } = attempt;
    const beatmaps = dan.beatmaps;

    logger.info('Starting attempt', {
      attemptId,
      danId: dan.id,
      danName: dan.name,
      username: user.osuUsername,
    });

    // Use MatchGenerator to handle static course shuffle selection
    const banchoClient = bot.getClient();
    const { finalMaps } = await matchGenerator.generateMatchMaps(
      banchoClient,
      attemptId,
      user.osuId,
      user.osuUsername,
      beatmaps,
    );

    const finalMapList = finalMaps;
    logger.info('Match generation complete', {
      mapCount: finalMapList.length,
    });

    // Step 6: Create multiplayer lobby
    const lobbyName = `osu!dojo: ${user.osuUsername} - ${dan.name} (#${attemptId})`;
    const channel = await bot.createLobby(lobbyName);
    const lobby = (channel as unknown as { lobby: unknown }).lobby as unknown as { id: number };
    const matchId = lobby.id.toString();

    // Persist multiplayer IDs
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        multiplayerId: matchId,
        multiplayerUrl: `https://osu.ppy.sh/mp/${matchId}`,
      },
    });

    // Save lobby state to Redis for recovery
    const { saveLobbyState } = await import('./recovery');
    const selfId = (bot.getClient() as unknown as { self?: { id?: number } }).self?.id;

    const mapDbIds = finalMapList.map((m) => m.id);

    await saveLobbyState(matchId, {
      attemptId,
      userId: user.id,
      osuUsername: user.osuUsername,
      danId: dan.id,
      danName: dan.name,
      status: 'PLAYING',
      currentMapIndex: 0,
      matchId,
      channelName: `#mp_${matchId}`,
      botOsuId: typeof selfId === 'number' ? selfId : 0,
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      mapsCompleted: 0,
      mapDbIds,
    });

    // Build manager map config
    const maps = finalMapList.map((m) => ({
      id: m.id,
      beatmapId: m.beatmapId,
      mods: m.mods,
      name: m.beatmapTitle ?? `Beatmap ${m.beatmapId}`,
      requiredScore: m.requiredScore,
      goldClearScore: m.goldClearScore,
      requiredAccuracy: m.requiredAccuracy ?? null,
      maxMisses: m.maxMisses ?? null,
      minCombo: m.minCombo ?? null,
      goldRequiredAccuracy: m.goldRequiredAccuracy ?? null,
      goldMaxMisses: m.goldMaxMisses ?? null,
      goldMinCombo: m.goldMinCombo ?? null,
      skillFocus: m.skillFocus ?? undefined,
      gameMode: m.gameMode,
    }));

    const manager = new MultiplayerManager(
      (channel as unknown as { lobby: BanchoJs.BanchoLobby }).lobby,
      {
        attemptId,
        multiplayerId: matchId,
        username: user.osuUsername,
        danName: dan.name,
        maps,
        onDone: () => {
          managers.delete(manager);
        },
      },
    );

    managers.add(manager);
    await manager.start();
  } catch (error) {
    logger.error('Failed to process attempt', { attemptId, error });
    throw error;
  }
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    console.error(
      'Error: Missing OSU_IRC_USERNAME/OSU_IRC_PASSWORD.\n' +
        '- Ensure repo root `.env` contains them, OR export them in your shell.\n' +
        '- OSU_IRC_PASSWORD must be the IRC password from https://osu.ppy.sh/p/irc (not your osu! website password).',
    );
    process.exit(1);
  }

  if (process.env.OSU_IRC_PASSWORD !== undefined && process.env.OSU_IRC_PASSWORD !== PASSWORD) {
    logger.warn('OSU_IRC_PASSWORD has leading/trailing whitespace; using trimmed value.');
  }

  // Optional (enables osu! API features such as user verification / reconciliation)
  if (!process.env.OSU_CLIENT_ID || !process.env.OSU_CLIENT_SECRET) {
    logger.warn(
      'OSU_CLIENT_ID/OSU_CLIENT_SECRET not set; osu! API-dependent features may fail (user verification, reconciliation).',
    );
  }

  console.log('Starting osu!dojo bot...');

  const bot = new BotClient(USERNAME, PASSWORD, API_KEY);

  try {
    await bot.connect();
    console.log('Bot connected successfully!');

    // Register DM command handlers
    registerCommands(bot.getClient());
    logger.info('DM command handlers registered');

    // ============================================
    // CRASH RECOVERY: Find and recover zombie lobbies
    // ============================================
    console.log('[Recovery] Scanning for zombie lobbies...');
    const zombies = await findZombieLobbies();

    if (zombies.length > 0) {
      console.log(`[Recovery] Found ${zombies.length} zombie lobby(ies)`);

      for (const zombie of zombies) {
        console.log(
          `[Recovery] Attempting to recover: ${zombie.danName} (Match: ${zombie.matchId})`,
        );

        try {
          if (zombie.mapDbIds.length === 0) {
            throw new Error('Missing mapDbIds in lobby state; cannot safely resume.');
          }

          // Rejoin the multiplayer channel
          const channel = await bot.joinLobby(zombie.matchId);

          // Reconcile what happened during downtime (API-based best-effort)
          const { newMapIndex, missingScores } = await reconcileMatchHistory(
            zombie.matchId,
            zombie.attemptId,
            zombie.currentMapIndex,
          );

          if (missingScores.length > 0) {
            console.log(
              `[Recovery] Backfilled ${missingScores.length} missing score(s) from API`,
            );
          }

          // Rebuild the exact map list (order preserved)
          const mapsFromDb = await prisma.beatmap.findMany({
            where: { id: { in: zombie.mapDbIds } },
          });
          const byId = new Map(mapsFromDb.map((m) => [m.id, m]));
          const ordered = zombie.mapDbIds
            .map((id) => byId.get(id))
            .filter((m): m is NonNullable<typeof m> => !!m);

          if (ordered.length !== zombie.mapDbIds.length) {
            throw new Error('Some beatmaps from mapDbIds are missing in DB; cannot safely resume.');
          }

          const maps = ordered.map((m) => ({
            id: m.id,
            beatmapId: m.beatmapId,
            mods: m.mods,
            name: m.beatmapTitle ?? `Beatmap ${m.beatmapId}`,
            requiredScore: m.requiredScore,
            goldClearScore: m.goldClearScore,
            skillFocus: m.skillFocus ?? undefined,
            gameMode: m.gameMode,
          }));

          // Update DB attempt progress (best-effort)
          await prisma.attempt.update({
            where: { id: zombie.attemptId },
            data: { currentMapIndex: newMapIndex, mapsCompleted: Math.max(0, newMapIndex) },
          });

          console.log(`[Recovery] ✓ Rejoined lobby, resuming from map ${newMapIndex + 1}`);

          const manager = new MultiplayerManager(
            (channel as unknown as { lobby: BanchoJs.BanchoLobby }).lobby,
            {
              attemptId: zombie.attemptId,
              multiplayerId: zombie.matchId,
              username: zombie.osuUsername,
              danName: zombie.danName,
              maps,
              startMapIndex: newMapIndex,
              onDone: () => {
                activeManagers.delete(manager);
              },
            },
          );

          activeManagers.add(manager);
          await manager.start();
        } catch (error) {
          console.error(`[Recovery] ✗ Failed to recover ${zombie.matchId}:`, error);

          // Fallback: abandon and requeue a fresh attempt
          try {
            const { abandonAttempt, deleteLobbyState } = await import('./recovery');
            await abandonAttempt(zombie.attemptId, zombie.currentMapIndex);
            await deleteLobbyState(zombie.matchId);

            const dan = await prisma.dan.findUnique({ where: { id: zombie.danId } });
            if (!dan) {
              logger.error('Fallback requeue failed: dan missing', {
                danId: zombie.danId,
                attemptId: zombie.attemptId,
              });
              continue;
            }

            const fresh = await prisma.attempt.create({
              data: {
                userId: zombie.userId,
                danId: zombie.danId,
                status: 'IN_PROGRESS',
              },
            });
            await enqueueAttempt(fresh.id);
            console.log(`[Recovery] Fallback: created and queued fresh attempt #${fresh.id}`);
          } catch (fallbackError) {
            logger.error('Fallback abandon+requeue failed', { fallbackError });
          }
        }
      }
    } else {
      logger.info('No zombie lobbies found');
    }

    // ============================================
    // QUEUE CONSUMER: Process queued attempts
    // ============================================
    logger.info('Starting queue consumer...');

    const processQueue = async () => {
      while (true) {
        try {
          // Block for up to 5 seconds waiting for next attempt
          const attemptId = await dequeueAttempt(5);

          if (attemptId) {
            logger.info('Dequeued attempt', { attemptId });
            await processAttempt(bot, attemptId, activeManagers);
          }
        } catch (error) {
          logger.error('Queue processing error', { error });
          // Wait before retrying to avoid tight loop on persistent errors
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    };

    // Start queue consumer (runs indefinitely)
    processQueue().catch((error) => {
      logger.error('Fatal queue error', { error });
      process.exit(1);
    });

    // Start heartbeat checker (every 1 minute)
    setInterval(async () => {
      await checkStuckLobbies();
    }, 60 * 1000);

    // Example: Create a test lobby
    // Uncomment below to test lobby creation
    /*
    const channel = await bot.createLobby("osu!dojo Test");
    console.log(`Lobby created: https://osu.ppy.sh/mp/${channel.lobby.id}`);

    const manager = new MultiplayerManager(channel.lobby, {
      username: "TargetPlayer",
      danName: "Test Dan",
      maps: [
        { beatmapId: 75, mods: ["NM"] }, // Hitorigoto
        { beatmapId: 1262832, mods: ["HD"] },
      ],
      requiredScore: 900000,
      allowBans: 0,
    });

    await manager.start();
    */
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('bancho auth failed')) {
      console.error(
        'Failed to start bot: Bancho auth failed.\n' +
          '- Double-check OSU_IRC_USERNAME and OSU_IRC_PASSWORD.\n' +
          '- Use the IRC password from https://osu.ppy.sh/p/irc (not your osu! website password).\n' +
          '- If you copied the password, retype it to avoid hidden whitespace.',
      );
    } else {
      console.error('Failed to start bot:', error);
    }
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 * Closes all active lobbies before exiting to prevent zombie rooms
 */
async function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down bot...`);

  if (activeManagers.size > 0) {
    console.log(`Closing ${activeManagers.size} active lobby(ies)...`);

    const closePromises = Array.from(activeManagers).map(async (manager) => {
      try {
        await manager.cleanup();
        console.log(`✓ Lobby closed`);
      } catch (error) {
        console.error(`✗ Failed to close lobby:`, error);
      }
    });

    await Promise.allSettled(closePromises);
    activeManagers.clear();
  }

  console.log('Bot shutdown complete');
  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main();
