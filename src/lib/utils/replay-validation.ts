import 'server-only';
import { getBeatmapMD5 } from './replay-parser';
import type { Replay } from 'osu-parser';
import type { Beatmap, AttemptScore, User } from '@prisma/client';

/**
 * Replay validation result
 */
export interface ReplayValidationResult {
  valid: boolean;
  error?: string;
  replay?: Replay;
}

/**
 * Validate uploaded replay file against multiplayer score
 *
 * This is the CRITICAL anti-cheat validation that ensures replays match
 * what actually happened in the multiplayer lobby.
 *
 * Validation checks (in order of importance):
 * 1. Timestamp matching (can't fake - must be within 5s of multiplayer play)
 * 2. Beatmap MD5 verification (correct map)
 * 3. Player name verification (correct player)
 * 4. Game mode verification (correct mode)
 * 5. Exact score matching (no tolerance)
 * 6. Exact hit count matching (300/100/50/miss/combo)
 */
export async function validateReplayFile(
  replayBuffer: Buffer,
  attemptScore: AttemptScore,
  beatmap: Beatmap,
  user: User,
): Promise<ReplayValidationResult> {
  let replay: Replay;

  // Step 1: Parse replay file
  try {
    const { parseReplay } = await import('osu-parser');
    replay = parseReplay(replayBuffer);
  } catch (error) {
    return {
      valid: false,
      error: `Replay file corrupted or invalid format: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  // Step 2: Timestamp validation (CRITICAL - can't be faked)
  // This proves the replay is from the exact multiplayer session
  if (replay.timestamp && attemptScore.playedAt) {
    const replayTime = new Date(replay.timestamp).getTime();
    const dbPlayTime = attemptScore.playedAt.getTime();
    const timeDiff = Math.abs(replayTime - dbPlayTime);

    // Allow 5 second tolerance for client/server clock differences
    if (timeDiff > 5000) {
      return {
        valid: false,
        error: `Replay timestamp mismatch: replay was played at ${new Date(replayTime).toISOString()}, but multiplayer score was at ${attemptScore.playedAt.toISOString()} (${Math.floor(timeDiff / 1000)}s difference)`,
      };
    }
  }

  // Step 3: Beatmap MD5 verification
  const expectedMD5 = await getBeatmapMD5(beatmap.beatmapId);
  if (expectedMD5 && replay.beatmap_md5 !== expectedMD5) {
    return {
      valid: false,
      error: `Beatmap MD5 mismatch: replay is for a different beatmap or modified beatmap file`,
    };
  }

  // Step 4: Player name verification
  if (replay.player_name !== user.osuUsername) {
    return {
      valid: false,
      error: `Player name mismatch: replay is by "${replay.player_name}", but attempt is by "${user.osuUsername}"`,
    };
  }

  // Step 5: Game mode verification
  const gameModeMap: Record<string, number> = {
    OSU: 0,
    TAIKO: 1,
    CATCH: 2,
    MANIA: 3,
  };
  const expectedMode = gameModeMap[beatmap.gameMode];
  if (replay.mode !== expectedMode) {
    return {
      valid: false,
      error: `Game mode mismatch: replay is for mode ${replay.mode}, but beatmap requires ${beatmap.gameMode}`,
    };
  }

  // Step 6: Exact score matching (no tolerance - must be exact)
  const replayScore = replay.score || 0;
  const dbScore = Number(attemptScore.score);
  if (replayScore !== dbScore) {
    return {
      valid: false,
      error: `Score mismatch: replay score is ${replayScore}, but multiplayer score was ${dbScore}`,
    };
  }

  // Step 7: Exact hit count matching
  const replayCombo = replay.max_combo || 0;
  const dbCombo = attemptScore.combo;
  if (replayCombo !== dbCombo) {
    return {
      valid: false,
      error: `Combo mismatch: replay max combo is ${replayCombo}, but multiplayer combo was ${dbCombo}`,
    };
  }

  const replay300 = replay.count_300 || 0;
  const db300 = attemptScore.count300;
  if (replay300 !== db300) {
    return {
      valid: false,
      error: `Hit count mismatch: replay has ${replay300} x300, but multiplayer had ${db300} x300`,
    };
  }

  const replay100 = replay.count_100 || 0;
  const db100 = attemptScore.count100;
  if (replay100 !== db100) {
    return {
      valid: false,
      error: `Hit count mismatch: replay has ${replay100} x100, but multiplayer had ${db100} x100`,
    };
  }

  const replay50 = replay.count_50 || 0;
  const db50 = attemptScore.count50;
  if (replay50 !== db50) {
    return {
      valid: false,
      error: `Hit count mismatch: replay has ${replay50} x50, but multiplayer had ${db50} x50`,
    };
  }

  const replayMiss = replay.count_miss || 0;
  const dbMiss = attemptScore.countMiss;
  if (replayMiss !== dbMiss) {
    return {
      valid: false,
      error: `Hit count mismatch: replay has ${replayMiss} misses, but multiplayer had ${dbMiss} misses`,
    };
  }

  // All checks passed!
  return {
    valid: true,
    replay,
  };
}
