import 'server-only';
import { calculateAccuracy as calculateAccuracyDecimal } from './scoring';
import { getStorage } from './core/storage';
import type { ScoreTimestamp } from './utils/time-series';
import type { Beatmap, Replay } from 'osu-parser';

type OsuParserModule = {
  parseReplay: (buffer: Buffer) => Replay;
  parseBeatmap: (content: string) => Beatmap;
};

let cachedOsuParser: OsuParserModule | null = null;

function isOsuParserModule(value: unknown): value is OsuParserModule {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.parseReplay === 'function' && typeof record.parseBeatmap === 'function';
}

async function getOsuParser(): Promise<OsuParserModule> {
  if (cachedOsuParser) return cachedOsuParser;

  const mod = (await import('osu-parser')) as unknown;
  const maybeWithDefault = mod as { default?: unknown };
  const parser = maybeWithDefault.default ?? mod;

  if (!isOsuParserModule(parser)) {
    throw new Error('osu-parser import shape is unexpected');
  }

  cachedOsuParser = parser;
  return parser;
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
 * @param replayKey - Storage key for the .osr replay file
 * @param beatmapId - osu! beatmap ID
 * @returns Array of score timestamps for pacemaker comparison
 */
export async function parseReplayToTimeSeries(
  replayKey: string,
  beatmapId: number,
): Promise<ScoreTimestamp[]> {
  const { parseReplay } = await getOsuParser();
  const storage = getStorage();

  // 1. Parse Replay (.osr) for final stats
  const replayBuffer = await storage.read(replayKey);
  const replay = parseReplay(replayBuffer);

  // 2. Fetch and Parse Beatmap (.osu) for hit object timing
  const beatmap = await getCachedBeatmap(beatmapId);

  if (!beatmap || !replay) {
    throw new Error('Failed to parse replay or beatmap');
  }

  // 3. Extract hit objects and sort by time
  const hitObjects = (beatmap as ParsedBeatmap).hitObjects.sort(
    (a, b) => a.startTime - b.startTime,
  );

  const finalScore = replay.score || 0;
  const finalCombo = replay.max_combo || 0;
  const finalAccDecimal = calculateAccuracyDecimal(
    replay.count_300 || 0,
    replay.count_100 || 0,
    replay.count_50 || 0,
    replay.count_miss || 0,
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
 * Fetch .osu beatmap file and cache using storage abstraction
 * Uses osu.ppy.sh direct download (no auth required)
 */
async function getCachedBeatmap(beatmapId: number) {
  const { parseBeatmap } = await getOsuParser();
  const storage = getStorage();
  const cacheKey = `beatmaps/${beatmapId}.osu`;

  // Check cache first
  if (await storage.exists(cacheKey)) {
    const content = await storage.readText(cacheKey);
    return parseBeatmap(content);
  }

  // Ensure cache directory exists
  await storage.ensureDir(cacheKey);

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

    // Cache the file using storage abstraction
    await storage.write(cacheKey, content);
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
  const storage = getStorage();
  const cacheKey = `beatmaps/${beatmapId}.osu`;

  try {
    // Ensure beatmap is cached first
    await getCachedBeatmap(beatmapId);

    if (!(await storage.exists(cacheKey))) {
      return null;
    }

    // Read the file content using storage abstraction
    const content = await storage.readText(cacheKey);

    // Compute MD5 hash of the content
    const crypto = await import('crypto');
    const hash = crypto.createHash('md5').update(content).digest('hex');

    return hash;
  } catch (error) {
    console.error(`[Beatmap] Failed to compute MD5 for ${beatmapId}:`, error);
    return null;
  }
}

export type { ScoreTimestamp };
