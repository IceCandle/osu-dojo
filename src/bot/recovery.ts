/**
 * Bot Recovery System
 * Handles lobby state persistence and crash recovery
 *
 * Strategy: "Redis remembers everything, API reconciles the past"
 */

import { redis, scanKeys } from '@/lib/core/redis';
import { prisma } from '@/lib/core/prisma';
import { evaluateBeatmapRequirements } from '@/lib/beatmap-requirements';

/**
 * Lobby state stored in Redis
 * Persists across bot crashes
 */
export interface LobbyState {
  attemptId: number;
  userId: number;
  osuUsername: string;
  danId: number;
  danName: string;
  status: 'PLAYING' | 'COMPLETED' | 'ABANDONED';
  currentMapIndex: number;
  matchId: string; // osu! official match ID (e.g., "11223344")
  channelName: string; // IRC channel (e.g., "#mp_11223344")
  botOsuId: number; // Bot's osu! ID (for host verification)
  startedAt: number; // Unix timestamp
  lastHeartbeat: number; // Last activity timestamp
  mapsCompleted: number;
  mapDbIds: number[]; // Ordered Beatmap.id list used for resume
}

/**
 * Save lobby state to Redis
 * Called after every significant event (map start, map complete, etc.)
 */
export async function saveLobbyState(matchId: string, state: LobbyState): Promise<void> {
  const key = `lobby:${matchId}`;

  await redis.hset(key, {
    attemptId: state.attemptId.toString(),
    userId: state.userId.toString(),
    osuUsername: state.osuUsername,
    danId: state.danId.toString(),
    danName: state.danName,
    status: state.status,
    currentMapIndex: state.currentMapIndex.toString(),
    matchId: state.matchId,
    channelName: state.channelName,
    botOsuId: state.botOsuId.toString(),
    startedAt: state.startedAt.toString(),
    lastHeartbeat: Date.now().toString(),
    mapsCompleted: state.mapsCompleted.toString(),
    mapDbIds: JSON.stringify(state.mapDbIds), // Added for rejoin+resume recovery
  });

  // Set expiry (24 hours - long enough for recovery)
  await redis.expire(key, 86400);
}

/**
 * Get lobby state from Redis
 */
export async function getLobbyState(matchId: string): Promise<LobbyState | null> {
  const key = `lobby:${matchId}`;
  const data = await redis.hgetall(key);

  if (Object.keys(data).length === 0) {
    return null;
  }

  return {
    attemptId: parseInt(data.attemptId),
    userId: parseInt(data.userId),
    osuUsername: data.osuUsername,
    danId: parseInt(data.danId),
    danName: data.danName,
    status: data.status as 'PLAYING' | 'COMPLETED' | 'ABANDONED',
    currentMapIndex: parseInt(data.currentMapIndex),
    matchId: data.matchId,
    channelName: data.channelName,
    botOsuId: parseInt(data.botOsuId),
    startedAt: parseInt(data.startedAt),
    lastHeartbeat: parseInt(data.lastHeartbeat),
    mapsCompleted: parseInt(data.mapsCompleted),
    mapDbIds: data.mapDbIds ? JSON.parse(data.mapDbIds) : [], // Added for rejoin+resume recovery
  };
}

/**
 * Delete lobby state (called after successful completion)
 */
export async function deleteLobbyState(matchId: string): Promise<void> {
  await redis.del(`lobby:${matchId}`);
}

/**
 * Update heartbeat timestamp
 * Called periodically to indicate bot is alive
 */
export async function updateHeartbeat(matchId: string): Promise<void> {
  const key = `lobby:${matchId}`;
  await redis.hset(key, 'lastHeartbeat', Date.now().toString());
}

/**
 * Find all "zombie" lobbies on bot startup
 * Returns lobbies that were active when bot crashed
 */
export async function findZombieLobbies(): Promise<LobbyState[]> {
  const keys = await scanKeys('lobby:*', { count: 500, maxKeys: 25_000 });
  const zombieLobbies: LobbyState[] = [];

  for (const key of keys) {
    const data = await redis.hgetall(key);

    // Only recover lobbies that were "PLAYING"
    if (data.status === 'PLAYING') {
      zombieLobbies.push({
        attemptId: parseInt(data.attemptId),
        userId: parseInt(data.userId),
        osuUsername: data.osuUsername,
        danId: parseInt(data.danId),
        danName: data.danName,
        status: data.status as 'PLAYING',
        currentMapIndex: parseInt(data.currentMapIndex),
        matchId: data.matchId,
        channelName: data.channelName,
        botOsuId: parseInt(data.botOsuId),
        startedAt: parseInt(data.startedAt),
        lastHeartbeat: parseInt(data.lastHeartbeat),
        mapsCompleted: parseInt(data.mapsCompleted),
        mapDbIds: data.mapDbIds ? JSON.parse(data.mapDbIds) : [], // Added for rejoin+resume recovery
      });
    }
  }

  return zombieLobbies;
}

/**
 * Backfill missing scores to database
 * Called during crash recovery to save scores that were played while bot was down
 *
 * @param attemptId - Database attempt ID
 * @param missingScores - Scores from osu! API that aren't in database
 * @param mapDbIds - Ordered list of Beatmap.id (DB primary keys) for this attempt
 */
async function backfillMissingScores(
  attemptId: number,
  missingScores: Array<{
    beatmapId: number;
    score: number;
    passed: boolean;
    accuracy: number; // 0-1 format from API
    maxCombo: number;
    count300: number;
    count100: number;
    count50: number;
    countMiss: number;
    sliderbreaks: number;
  }>,
  mapDbIds: number[],
): Promise<void> {
  if (missingScores.length === 0) {
    return;
  }

  console.log(`[Backfill] Starting backfill for ${missingScores.length} missing score(s)`);

  // Fetch beatmap records to map osu! beatmapId → Beatmap.id
  const beatmaps = await prisma.beatmap.findMany({
    where: { id: { in: mapDbIds } },
  });

  // Create lookup map: osu! beatmapId → DB Beatmap record
  const beatmapIdToRecord = new Map<number, (typeof beatmaps)[0]>();
  for (const bm of beatmaps) {
    beatmapIdToRecord.set(bm.beatmapId, bm);
  }

  // Save each missing score
  for (const missing of missingScores) {
    const beatmap = beatmapIdToRecord.get(missing.beatmapId);

    if (!beatmap) {
      console.warn(
        `[Backfill] Skipping score for unknown beatmap ${missing.beatmapId} (not in current dan)`,
      );
      continue;
    }

    const requirementEval = evaluateBeatmapRequirements(
      {
        requiredScore: beatmap.requiredScore,
        goldClearScore: beatmap.goldClearScore,
        requiredAccuracy: beatmap.requiredAccuracy,
        maxMisses: beatmap.maxMisses,
        minCombo: beatmap.minCombo,
        goldRequiredAccuracy: beatmap.goldRequiredAccuracy,
        goldMaxMisses: beatmap.goldMaxMisses,
        goldMinCombo: beatmap.goldMinCombo,
      },
      {
        score: BigInt(missing.score),
        accuracy: missing.accuracy * 100,
        combo: missing.maxCombo,
        countMiss: missing.countMiss,
        effectiveMisses: missing.countMiss,
      },
      'normal',
    );

    const metRequirement = requirementEval.met;

    // Check if score already exists (prevent duplicates)
    const existing = await prisma.attemptScore.findUnique({
      where: { attemptId_beatmapId: { attemptId, beatmapId: beatmap.id } },
    });

    if (existing) {
      console.log(`[Backfill] Score already exists for beatmap ${beatmap.id}, skipping`);
      continue;
    }

    try {
      // NOTE: The osu! API match history does not provide reliable sliderbreak counts.
      // During recovery we treat sliderbreaks as unknown (0) and let replay parsing / overlay fill later.
      const sliderbreaks = 0;

      // Create AttemptScore record with data from API
      await prisma.attemptScore.create({
        data: {
          attemptId,
          beatmapId: beatmap.id, // Use DB primary key, NOT osu! beatmapId
          score: BigInt(missing.score),
          accuracy: missing.accuracy * 100, // Convert 0-1 to 0-100 percentage
          combo: missing.maxCombo,
          count300: missing.count300,
          count100: missing.count100,
          count50: missing.count50,
          countMiss: missing.countMiss,
          sliderbreaks,
          effectiveMisses: missing.countMiss + sliderbreaks,
          passed: missing.passed,
          metRequirement,
          modsUsed: beatmap.mods,
          playedAt: new Date(), // Best-effort timestamp
        },
      });

      console.log(
        `[Backfill] ✓ Saved score for beatmap ${beatmap.id} (osu! ID: ${missing.beatmapId}, accuracy: ${(missing.accuracy * 100).toFixed(2)}%)`,
      );
    } catch (error) {
      console.error(
        `[Backfill] ✗ Failed to save score for beatmap ${beatmap.id}:`,
        error instanceof Error ? error.message : error,
      );
      // Continue with other scores even if one fails
    }
  }

  console.log(`[Backfill] Backfill complete`);
}

/**
 * Reconcile match history with database
 *
 * Design notes live in docs/recovery-strategy.md.
 *
 * @param matchId - osu! multiplayer match ID
 * @param attemptId - Database attempt ID
 * @param expectedMapIndex - Last known map index before disconnect
 * @returns Recovery state with missing scores
 */
export async function reconcileMatchHistory(
  matchId: string,
  attemptId: number,
  expectedMapIndex: number,
): Promise<{
  newMapIndex: number;
  missingScores: Array<{
    beatmapId: number;
    score: number;
    passed: boolean;
    accuracy: number;
    maxCombo: number;
    count300: number;
    count100: number;
    count50: number;
    countMiss: number;
    sliderbreaks: number;
  }>;
}> {
  console.log(`[Recovery] Reconciling match ${matchId} for attempt ${attemptId}`);

  try {
    const { osuApi } = await import('@/lib/osu-api');

    // Fetch attempt with user and existing scores
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        user: true,
        scores: {
          orderBy: { playedAt: 'asc' },
          include: { beatmap: true },
        },
      },
    });

    if (!attempt) {
      console.error(`[Recovery] Attempt ${attemptId} not found`);
      return { newMapIndex: expectedMapIndex, missingScores: [] };
    }

    // Fetch match history from osu! API
    const match = await osuApi.getMatch(matchId);

    if (!match) {
      console.warn(`[Recovery] Match ${matchId} not found via API (may be > 24h old)`);
      return { newMapIndex: expectedMapIndex, missingScores: [] };
    }

    // Type definitions based on osu-api-v2-js (more complete than before)
    type OsuMatchScore = {
      user_id: number;
      score: number;
      passed: boolean;
      accuracy: number; // 0-1 format (e.g., 0.9640 = 96.40%)
      max_combo: number;
      statistics?: {
        great?: number; // count300
        ok?: number; // count100
        meh?: number; // count50
        miss?: number; // countMiss
      };
    };

    type OsuMatchGame = {
      beatmap_id: number;
      end_time: string;
      scores?: OsuMatchScore[];
    };

    type OsuMatchEvent = {
      detail?: { type?: string };
      game?: OsuMatchGame;
    };

    type OsuMatch = {
      events?: OsuMatchEvent[];
    };

    const matchData = match as unknown as OsuMatch;

    // Extract game events
    const apiGames = (matchData.events ?? [])
      .filter((e) => e.detail?.type === 'other' && !!e.game)
      .map((e) => e.game as OsuMatchGame);

    console.log(
      `[Recovery] Match history fetched: ${apiGames.length} games found, ${attempt.scores.length} in DB`,
    );

    // Find missing scores
    const missingScores: Array<{
      beatmapId: number;
      score: number;
      passed: boolean;
      accuracy: number;
      maxCombo: number;
      count300: number;
      count100: number;
      count50: number;
      countMiss: number;
      sliderbreaks: number;
    }> = [];

    for (const game of apiGames) {
      const playerScore = (game.scores ?? []).find((s) => s.user_id === attempt.user.osuId);

      if (!playerScore) continue;

      // Check if score already exists in DB (within 1 minute tolerance)
      const existsInDb = attempt.scores.find((ds: { beatmap: { beatmapId: number }; playedAt: Date }) =>
        ds.beatmap.beatmapId === game.beatmap_id &&
        Math.abs(new Date(ds.playedAt).getTime() - new Date(game.end_time).getTime()) < 60000, // 1 minute tolerance
      );

      if (!existsInDb) {
        missingScores.push({
          beatmapId: game.beatmap_id,
          score: playerScore.score,
          passed: playerScore.passed,
          accuracy: playerScore.accuracy ?? 0,
          maxCombo: playerScore.max_combo ?? 0,
          count300: playerScore.statistics?.great ?? 0,
          count100: playerScore.statistics?.ok ?? 0,
          count50: playerScore.statistics?.meh ?? 0,
          countMiss: playerScore.statistics?.miss ?? 0,
          // The osu! API match history does not reliably expose sliderbreak counts.
          // Keep this 0 during recovery; replay parsing / overlay can populate later.
          sliderbreaks: 0,
        });
      }
    }

    const newMapIndex = attempt.scores.length + missingScores.length;

    console.log(
      `[Recovery] Reconciliation complete: ${missingScores.length} missing scores found, new map index: ${newMapIndex}`,
    );

    // Backfill missing scores to database
    if (missingScores.length > 0) {
      const state = await getLobbyState(matchId);
      if (state?.mapDbIds && state.mapDbIds.length > 0) {
        await backfillMissingScores(attemptId, missingScores, state.mapDbIds);
        console.log(`[Recovery] Backfilled ${missingScores.length} missing score(s) to database`);
      } else {
        console.warn(`[Recovery] Cannot backfill - mapDbIds missing from lobby state`);
      }
    }

    return { newMapIndex, missingScores };
  } catch (error) {
    console.error(`[Recovery] Match reconciliation failed for ${matchId}:`, error);
    return { newMapIndex: expectedMapIndex, missingScores: [] };
  }
}

/**
 * Automatic-only policy: attempts are never user-paused/resumed.
 * If a lobby is detected as stuck, mark attempt ABANDONED.
 */
export async function abandonAttempt(attemptId: number, currentMapIndex: number): Promise<void> {
  await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      status: 'ABANDONED',
      currentMapIndex,
      updatedAt: new Date(),
      completedAt: new Date(),
    },
  });

  console.log(`[Recovery] Attempt ${attemptId} abandoned at map ${currentMapIndex + 1}`);
}

/**
 * Heartbeat checker (runs periodically)
 * Detects stuck lobbies and marks them for recovery
 */
export async function checkStuckLobbies(): Promise<void> {
  const keys = await scanKeys('lobby:*', { count: 500, maxKeys: 25_000 });
  const now = Date.now();
  const HEARTBEAT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  for (const key of keys) {
    const data = await redis.hgetall(key);
    const lastHeartbeat = parseInt(data.lastHeartbeat);

    if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      console.warn(`[Recovery] Lobby ${data.matchId} has no heartbeat for 5 minutes`);

      const attemptId = parseInt(data.attemptId);
      const currentMapIndex = parseInt(data.currentMapIndex);

      await abandonAttempt(attemptId, currentMapIndex);
      await redis.del(key);
    }
  }
}
