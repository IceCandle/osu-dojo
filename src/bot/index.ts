import "dotenv/config";
import BanchoJs from "bancho.js";
import { BotClient } from "./client";
import { MultiplayerManager } from "./multiplayer";
import { findZombieLobbies, reconcileMatchHistory, checkStuckLobbies } from "./recovery";
import { registerCommands } from "./commands";
import { closeBanSession, createBanSession, dequeueAttempt, enqueueAttempt, getBanSelection } from "../lib/redis";
import { createLogger } from "../lib/logger";
import { prisma } from "../lib/prisma";

/**
 * Bot entry point
 * Usage: npm run bot
 */

const USERNAME = (process.env.OSU_IRC_USERNAME ?? "").trim();
const PASSWORD = (process.env.OSU_IRC_PASSWORD ?? "").trim();
const API_KEY = (process.env.OSU_API_KEY ?? "").trim();

// Track active multiplayer managers for cleanup
const activeManagers = new Set<MultiplayerManager>();

// Create logger for bot component
const logger = createLogger('Bot');

/**
 * Handle ban phase for candidate maps
 *
 * Phase 1: Returns empty bans (no user interaction)
 * Phase 1.5: Will integrate with DM commands for real-time ban selection
 *
 * @param candidateGroups - Map of candidate groups
 * @param maxBans - Maximum number of bans allowed
 * @param username - Player's osu! username
 * @returns Array of banned beatmap IDs
 */
async function handleBanPhase(
  bot: BotClient,
  attemptId: number,
  osuId: number,
  username: string,
  candidateGroups: Map<number, Array<{ id: number; beatmapId: number; beatmapTitle: string | null; orderIndex: number; candidateGroup: number | null }>>,
  maxBans: number
): Promise<{ bannedMapIds: number[]; bannedIndices: number[] }> {
  logger.info('Ban phase started', {
    username,
    maxBans,
    candidateGroupCount: candidateGroups.size,
  });

  if (maxBans <= 0 || candidateGroups.size === 0) return { bannedMapIds: [], bannedIndices: [] };

  // Build a stable, 1-based index list across all candidates.
  const sortedGroups = Array.from(candidateGroups.entries()).sort((a, b) => a[0] - b[0]);
  const candidates: Array<{
    index: number;
    beatmapDbId: number;
    beatmapId: number;
    title: string;
    candidateGroup: number;
  }> = [];

  for (const [group, maps] of sortedGroups) {
    const sortedMaps = [...maps].sort((a, b) => a.orderIndex - b.orderIndex);
    for (const map of sortedMaps) {
      candidates.push({
        index: candidates.length + 1,
        beatmapDbId: map.id,
        beatmapId: map.beatmapId,
        title: map.beatmapTitle ?? `Beatmap ${map.beatmapId}`,
        candidateGroup: group,
      });
    }
  }

  if (candidates.length === 0) return { bannedMapIds: [], bannedIndices: [] };

  const banchoClient = bot.getClient() as unknown as {
    getUser: (username: string) => { sendMessage: (message: string) => Promise<void> };
  };

  // Create short-lived ban session for DM handler to write into.
  await createBanSession(
    {
      attemptId,
      osuId,
      osuUsername: username,
      maxBans,
      createdAt: Date.now(),
      candidates,
    },
    60
  );

  // DM the candidate list (chunked to avoid overly long lines).
  const header = [
    `Ban phase for attempt #${attemptId}.`,
    `You may ban up to ${maxBans} map(s).`,
    `Reply within 30s: !dojo ban <indices> (example: !dojo ban 1 3)`,
    `Candidates:`,
  ];

  const lines = candidates.map(
    (c) => `${c.index}) [G${c.candidateGroup}] ${c.beatmapId} - ${c.title}`
  );

  const chunks: string[] = [];
  const all = [...header, ...lines];
  const chunkSize = 12;
  for (let i = 0; i < all.length; i += chunkSize) {
    chunks.push(all.slice(i, i + chunkSize).join('\n'));
  }

  try {
    for (const chunk of chunks) {
      await banchoClient.getUser(username).sendMessage(chunk);
    }
  } catch (error) {
    logger.error('Failed to DM ban list; proceeding with no bans', { attemptId, username, error });
    await closeBanSession(attemptId, osuId);
    return { bannedMapIds: [], bannedIndices: [] };
  }

  // Wait for ban selection up to 30 seconds.
  const timeoutMs = 30_000;
  const pollIntervalMs = 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const selection = await getBanSelection(attemptId);
    if (selection) {
      await closeBanSession(attemptId, osuId);

      const uniqueIndices = Array.from(new Set(selection.indices)).slice(0, maxBans);
      const uniqueDbIds = Array.from(new Set(selection.bannedBeatmapDbIds)).slice(0, maxBans);
      logger.info('Bans received', {
        attemptId,
        username,
        indices: uniqueIndices,
        bannedCount: uniqueDbIds.length,
      });
      return { bannedMapIds: uniqueDbIds, bannedIndices: uniqueIndices };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // No response: proceed with no bans.
  await closeBanSession(attemptId, osuId);
  logger.info('Ban phase timeout; proceeding with no bans', { attemptId, username });
  return { bannedMapIds: [], bannedIndices: [] };
}

/**
 * Process a queued attempt
 * Handles candidate map selection with ban-first logic
 */
async function processAttempt(
  bot: BotClient,
  attemptId: number,
  managers: Set<MultiplayerManager>
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
              orderBy: { orderIndex: 'asc' }
            }
          }
        },
        user: true
      }
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
      username: user.osuUsername
    });

    // Step 1: Organize beatmaps into non-candidates and candidate groups
    const nonCandidateMaps = beatmaps.filter(m => !m.isCandidate);
    const candidateGroups = new Map<number, typeof beatmaps>();

    beatmaps.forEach(map => {
      if (map.isCandidate && map.candidateGroup !== null) {
        if (!candidateGroups.has(map.candidateGroup)) {
          candidateGroups.set(map.candidateGroup, []);
        }
        candidateGroups.get(map.candidateGroup)!.push(map);
      }
    });

    // Step 2: BAN PHASE - user selects maps to ban (1-based indices via DM)
    const banResult = await handleBanPhase(
      bot,
      attemptId,
      user.osuId,
      user.osuUsername,
      candidateGroups,
      dan.allowedBans
    );
    const bannedMapIds = banResult.bannedMapIds;
    logger.info('Ban phase complete', { maxBans: dan.allowedBans, bannedCount: bannedMapIds.length });

    // Persist bans to the attempt (Beatmap.id values)
    if (bannedMapIds.length > 0) {
      await prisma.attempt.update({
        where: { id: attemptId },
        data: {
          bannedMapIds,
          bannedCount: bannedMapIds.length,
        },
      });
    }

    // Step 3: Remove banned maps from candidate pools
    candidateGroups.forEach((maps, group) => {
      candidateGroups.set(
        group,
        maps.filter(m => !bannedMapIds.includes(m.id))
      );
    });

    // Step 4: Random selection from REMAINING candidates in each group
    const selectedCandidates: typeof beatmaps = [];
    candidateGroups.forEach((maps, group) => {
      if (maps.length > 0) {
        const randomMap = maps[Math.floor(Math.random() * maps.length)];
        selectedCandidates.push(randomMap);
        logger.info('Selected candidate map', {
          group,
          beatmapId: randomMap.beatmapId,
          title: randomMap.beatmapTitle
        });
      }
    });

    // Step 5: Combine and sort by candidateGroup (NOT orderIndex)
    const finalMapList = [...nonCandidateMaps, ...selectedCandidates];
    finalMapList.sort((a, b) => {
      // Non-candidates keep their orderIndex
      if (!a.isCandidate && !b.isCandidate) return a.orderIndex - b.orderIndex;
      if (!a.isCandidate) return -1;
      if (!b.isCandidate) return 1;

      // Candidates sorted by candidateGroup
      return (a.candidateGroup || 0) - (b.candidateGroup || 0);
    });

    logger.info('Final map order determined', { mapCount: finalMapList.length });

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
      bannedMapIndices: banResult.bannedIndices,
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
      }
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
      "Error: Missing OSU_IRC_USERNAME/OSU_IRC_PASSWORD.\n" +
      "- Ensure repo root `.env` contains them, OR export them in your shell.\n" +
      "- OSU_IRC_PASSWORD must be the IRC password from https://osu.ppy.sh/p/irc (not your osu! website password)."
    );
    process.exit(1);
  }

  if (process.env.OSU_IRC_PASSWORD !== undefined && process.env.OSU_IRC_PASSWORD !== PASSWORD) {
    logger.warn('OSU_IRC_PASSWORD has leading/trailing whitespace; using trimmed value.');
  }

  // Optional (enables osu! API features such as user verification / reconciliation)
  if (!process.env.OSU_CLIENT_ID || !process.env.OSU_CLIENT_SECRET) {
    logger.warn('OSU_CLIENT_ID/OSU_CLIENT_SECRET not set; osu! API-dependent features may fail (user verification, reconciliation).');
  }

  console.log("Starting osu!dojo bot...");

  const bot = new BotClient(USERNAME, PASSWORD, API_KEY);

  try {
    await bot.connect();
    console.log("Bot connected successfully!");

    // Register DM command handlers
    registerCommands(bot.getClient());
    logger.info('DM command handlers registered');

    // ============================================
    // CRASH RECOVERY: Find and recover zombie lobbies
    // ============================================
    console.log("[Recovery] Scanning for zombie lobbies...");
    const zombies = await findZombieLobbies();

    if (zombies.length > 0) {
      console.log(`[Recovery] Found ${zombies.length} zombie lobby(ies)`);

      for (const zombie of zombies) {
        console.log(`[Recovery] Attempting to recover: ${zombie.danName} (Match: ${zombie.matchId})`);

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
            zombie.currentMapIndex
          );

          if (missingScores.length > 0) {
            console.log(`[Recovery] Found ${missingScores.length} missing score(s). (Backfill TODO)`);
          }

          // Rebuild the exact map list (order preserved)
          const mapsFromDb = await prisma.beatmap.findMany({
            where: { id: { in: zombie.mapDbIds } },
          });
          const byId = new Map(mapsFromDb.map((m) => [m.id, m]));
          const ordered = zombie.mapDbIds.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);

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
            }
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
              logger.error('Fallback requeue failed: dan missing', { danId: zombie.danId, attemptId: zombie.attemptId });
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
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    };

    // Start queue consumer (runs indefinitely)
    processQueue().catch(error => {
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
        "Failed to start bot: Bancho auth failed.\n" +
        "- Double-check OSU_IRC_USERNAME and OSU_IRC_PASSWORD.\n" +
        "- Use the IRC password from https://osu.ppy.sh/p/irc (not your osu! website password).\n" +
        "- If you copied the password, retype it to avoid hidden whitespace."
      );
    } else {
      console.error("Failed to start bot:", error);
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

  console.log("Bot shutdown complete");
  process.exit(0);
}

// Handle graceful shutdown
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main();
