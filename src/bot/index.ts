import 'dotenv/config';
import BanchoJs from 'bancho.js';
import { BotClient } from './client';
import { MultiplayerManager } from './managers/MultiplayerManager';
import { findZombieLobbies, reconcileMatchHistory, findStuckLobbies } from './recovery';
import { registerCommands } from './commands';
import { dequeueAttempt, redis } from '../lib/core/redis';
import { createLogger } from '../lib/core/logger';
import { prisma } from '../lib/core/prisma';
import { MatchGenerator } from '../lib/services/MatchGeneratorService';
import { BOT_TIMEOUTS } from './constants';
import { restartAttemptAndRequeue } from '@/lib/services/AttemptRestartService';

/**
 * Bot entry point
 * Usage: npm run bot
 */

const USERNAME = (process.env.OSU_IRC_USERNAME ?? '').trim();
const PASSWORD = (process.env.OSU_IRC_PASSWORD ?? '').trim();
const API_KEY = (process.env.OSU_API_KEY ?? '').trim();

// Track active multiplayer managers for cleanup
const activeManagers = new Set<MultiplayerManager>();
const activeAttemptIds = new Set<number>();

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
      scoringSystem: m.scoringSystem,
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
          activeAttemptIds.delete(attemptId);
        },
      },
    );

    managers.add(manager);
    activeAttemptIds.add(attemptId);
    await manager.start();
  } catch (error) {
    logger.error('Failed to process attempt', { attemptId, error });
    throw error;
  }
}

async function recoverLobby(
  bot: BotClient,
  lobby: {
    matchId: string;
    attemptId: number;
    currentMapIndex: number;
    mapDbIds: number[];
    osuUsername: string;
    danName: string;
  },
): Promise<void> {
  if (activeAttemptIds.has(lobby.attemptId)) {
    return;
  }

  if (lobby.mapDbIds.length === 0) {
    throw new Error('Missing mapDbIds in lobby state; cannot safely resume.');
  }

  const lockKey = `recovery:lock:${lobby.matchId}`;
  const locked = await redis.set(lockKey, String(Date.now()), 'PX', 2 * 60 * 1000, 'NX');
  if (locked !== 'OK') {
    return;
  }

  const lobbyKey = `lobby:${lobby.matchId}`;
  const recoveryAttempts = await redis.hincrby(lobbyKey, 'recoveryAttempts', 1);
  if (recoveryAttempts > 3) {
    throw new Error(`Exceeded auto-recovery attempts (${recoveryAttempts})`);
  }

  await redis.hset(lobbyKey, {
    status: 'RECOVERING',
    lastHeartbeat: String(Date.now()),
  });

  const channel = await bot.joinLobby(lobby.matchId);

  const { newMapIndex, missingScores } = await reconcileMatchHistory(
    lobby.matchId,
    lobby.attemptId,
    lobby.currentMapIndex,
  );

  if (missingScores.length > 0) {
    console.log(`[Recovery] Backfilled ${missingScores.length} missing score(s) from API`);
  }

  const mapsFromDb = await prisma.beatmap.findMany({ where: { id: { in: lobby.mapDbIds } } });
  const byId = new Map(mapsFromDb.map((m) => [m.id, m]));
  const ordered = lobby.mapDbIds
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m);

  if (ordered.length !== lobby.mapDbIds.length) {
    throw new Error('Some beatmaps from mapDbIds are missing in DB; cannot safely resume.');
  }

  const maps = ordered.map((m) => ({
    id: m.id,
    beatmapId: m.beatmapId,
    scoringSystem: m.scoringSystem,
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

  await prisma.attempt.update({
    where: { id: lobby.attemptId },
    data: { currentMapIndex: newMapIndex, mapsCompleted: Math.max(0, newMapIndex) },
  });

  await redis.hset(lobbyKey, {
    status: 'PLAYING',
    currentMapIndex: String(newMapIndex),
    mapsCompleted: String(Math.max(0, newMapIndex)),
    lastHeartbeat: String(Date.now()),
  });

  console.log(`[Recovery] ✓ Rejoined lobby, resuming from map ${newMapIndex + 1}`);

  const manager = new MultiplayerManager(
    (channel as unknown as { lobby: BanchoJs.BanchoLobby }).lobby,
    {
      attemptId: lobby.attemptId,
      multiplayerId: lobby.matchId,
      username: lobby.osuUsername,
      danName: lobby.danName,
      maps,
      startMapIndex: newMapIndex,
      onDone: () => {
        activeManagers.delete(manager);
        activeAttemptIds.delete(lobby.attemptId);
      },
    },
  );

  activeManagers.add(manager);
  activeAttemptIds.add(lobby.attemptId);
  await manager.start();
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
          await recoverLobby(bot, {
            matchId: zombie.matchId,
            attemptId: zombie.attemptId,
            currentMapIndex: zombie.currentMapIndex,
            mapDbIds: zombie.mapDbIds,
            osuUsername: zombie.osuUsername,
            danName: zombie.danName,
          });
        } catch (error) {
          console.error(`[Recovery] ✗ Failed to recover ${zombie.matchId}:`, error);

          // Fallback: restart the SAME attempt id and requeue
          try {
            await restartAttemptAndRequeue(zombie.attemptId);
            console.log(`[Recovery] Fallback: restarted and queued attempt #${zombie.attemptId}`);
          } catch (fallbackError) {
            logger.error('Fallback restart+requeue failed', { fallbackError });
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

    // Stuck-lobby watchdog: try to recover first, fallback to restart+requeue.
    setInterval(async () => {
      try {
        const stuck = await findStuckLobbies(BOT_TIMEOUTS.HEARTBEAT_TIMEOUT_MS);
        for (const lobby of stuck) {
          if (!lobby.matchId || !Number.isFinite(lobby.attemptId)) continue;

          try {
            await recoverLobby(bot, {
              matchId: lobby.matchId,
              attemptId: lobby.attemptId,
              currentMapIndex: lobby.currentMapIndex,
              mapDbIds: lobby.mapDbIds,
              osuUsername: lobby.osuUsername,
              danName: lobby.danName,
            });
          } catch (recoverError) {
            logger.warn('Auto-recovery failed; restarting attempt', {
              matchId: lobby.matchId,
              attemptId: lobby.attemptId,
              recoverError,
            });

            try {
              await restartAttemptAndRequeue(lobby.attemptId);
            } catch (restartError) {
              logger.error('Auto-restart failed', {
                matchId: lobby.matchId,
                attemptId: lobby.attemptId,
                restartError,
              });
            }
          }
        }
      } catch (error) {
        logger.warn('Stuck-lobby watchdog failed', { error });
      }
    }, BOT_TIMEOUTS.STUCK_LOBBY_CHECK_INTERVAL_MS);

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
