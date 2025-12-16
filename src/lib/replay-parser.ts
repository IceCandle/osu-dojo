import { parseReplay, parseBeatmap } from 'osu-parser';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { calculateAccuracy as calculateAccuracyDecimal } from './scoring';

export interface ScoreTimestamp {
  time: number;        // ms from start
  score: number;       // cumulative score
  combo: number;       // combo at this point
  accuracy: number;    // accuracy percentage (0-100)
}

// Type definitions for osu-parser library (which lacks complete TypeScript types)
interface HitObject {
  startTime: number;
  objectName?: string;
  position?: [number, number];
}

interface ParsedBeatmap {
  hitObjects: HitObject[];
  nbCircles?: number;
  nbSliders?: number;
  nbSpinners?: number;
}

/**
 * Generates accurate time-series data by combining Replay (.osr) + Beatmap (.osu).
 * This accounts for breaks and object density - score only increases at hit object times.
 *
 * @param replayPath - Path to .osr replay file
 * @param beatmapId - osu! beatmap ID
 * @returns Array of score timestamps for pacemaker comparison
 */
export async function parseReplayToTimeSeries(
  replayPath: string,
  beatmapId: number
): Promise<ScoreTimestamp[]> {
  // 1. Parse Replay (.osr) for final stats
  const replayBuffer = await fs.readFile(replayPath);
  const replay = parseReplay(replayBuffer);

  // 2. Fetch and Parse Beatmap (.osu) for hit object timing
  const beatmap = await getCachedBeatmap(beatmapId);

  if (!beatmap || !replay) {
    throw new Error('Failed to parse replay or beatmap');
  }

  // 3. Extract hit objects and sort by time
  const hitObjects = (beatmap as ParsedBeatmap).hitObjects.sort((a, b) => a.startTime - b.startTime);

  const finalScore = replay.score || 0;
  const finalCombo = replay.max_combo || 0;
  const finalAccDecimal = calculateAccuracyDecimal(
    replay.count_300 || 0,
    replay.count_100 || 0,
    replay.count_50 || 0,
    replay.count_miss || 0
  );
  const finalAcc = finalAccDecimal * 100; // Convert to percentage for display

  const totalObjects = hitObjects.length;
  const timeSeries: ScoreTimestamp[] = [];

  // Add start point (before first object)
  const firstObjTime = hitObjects[0]?.startTime || 0;
  timeSeries.push({
    time: Math.max(0, firstObjTime - 1000), // 1s before first note
    score: 0,
    combo: 0,
    accuracy: 100,
  });

  // 4. Create data points at each hit object timing
  // This naturally handles breaks - no score increase during breaks!
  hitObjects.forEach((obj, index) => {
    const progress = (index + 1) / totalObjects;

    // Non-linear scoring: later objects worth more due to combo multiplier
    // Use power curve to approximate osu! scoring
    const scoreProgress = Math.pow(progress, 1.8);

    timeSeries.push({
      time: obj.startTime, // EXACT time the note is hit
      score: Math.floor(finalScore * scoreProgress),
      combo: Math.floor(finalCombo * progress),
      accuracy: finalAcc, // Gold clear accuracy stays constant
    });
  });

  // Add end point (after last object + buffer for spinners/sliders)
  const lastObjTime = hitObjects[hitObjects.length - 1]?.startTime || 0;
  const replayEndTime = lastObjTime + 3000; // 3s buffer

  timeSeries.push({
    time: replayEndTime,
    score: finalScore,
    combo: finalCombo,
    accuracy: finalAcc,
  });

  return timeSeries;
}

// calculateAccuracy removed - now using calculateAccuracyDecimal from scoring.ts

/**
 * Fetch .osu beatmap file and cache locally
 * Uses osu.ppy.sh direct download (no auth required)
 */
async function getCachedBeatmap(beatmapId: number) {
  const cachePath = `./cache/beatmaps/${beatmapId}.osu`;

  // Check cache first
  if (existsSync(cachePath)) {
    const content = await fs.readFile(cachePath, 'utf-8');
    return parseBeatmap(content);
  }

  // Ensure cache directory exists
  await fs.mkdir('./cache/beatmaps', { recursive: true });

  try {
    // Download from osu.ppy.sh (public endpoint, no auth needed)
    console.log(`[Beatmap] Downloading ${beatmapId}...`);
    const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`, {
      headers: {
        'User-Agent': 'osu!dojo/1.0 (+https://github.com/yourusername/osudojo)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // Validate .osu file format (basic check)
    if (!content.includes('osu file format') && !content.includes('[HitObjects]')) {
      throw new Error('Invalid .osu file format');
    }

    // Cache the file
    await fs.writeFile(cachePath, content, 'utf-8');
    console.log(`[Beatmap] Cached ${beatmapId}`);

    return parseBeatmap(content);
  } catch (error) {
    console.error(`[Beatmap] Download failed for ${beatmapId}:`, error);
    return null;
  }
}

/**
 * Get beatmap MD5 hash from cached .osu file
 * The MD5 hash is computed from the file content, used for validation
 */
export async function getBeatmapMD5(beatmapId: number): Promise<string | null> {
  const cachePath = `./cache/beatmaps/${beatmapId}.osu`;

  try {
    // Ensure beatmap is cached first
    await getCachedBeatmap(beatmapId);

    if (!existsSync(cachePath)) {
      return null;
    }

    // Read the file content
    const content = await fs.readFile(cachePath, 'utf-8');

    // Compute MD5 hash of the content
    const crypto = await import('crypto');
    const hash = crypto.createHash('md5').update(content).digest('hex');

    return hash;
  } catch (error) {
    console.error(`[Beatmap] Failed to compute MD5 for ${beatmapId}:`, error);
    return null;
  }
}

/**
 * Get interpolated score at specific timestamp
 * Uses binary search for O(log n) lookup
 */
export function getScoreAtTime(
  timeSeries: ScoreTimestamp[],
  targetTime: number
): ScoreTimestamp {
  if (timeSeries.length === 0) {
    return { time: targetTime, score: 0, combo: 0, accuracy: 100 };
  }

  // Binary search for closest timestamps
  let left = 0;
  let right = timeSeries.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (timeSeries[mid].time < targetTime) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // Handle edge cases
  if (left === 0) return timeSeries[0];
  if (left >= timeSeries.length) return timeSeries[timeSeries.length - 1];

  // Linear interpolation between two closest points
  const before = timeSeries[left - 1];
  const after = timeSeries[left];

  if (after.time === before.time) return after;

  const progress = (targetTime - before.time) / (after.time - before.time);

  return {
    time: targetTime,
    score: Math.floor(before.score + (after.score - before.score) * progress),
    combo: Math.floor(before.combo + (after.combo - before.combo) * progress),
    accuracy: before.accuracy + (after.accuracy - before.accuracy) * progress,
  };
}

