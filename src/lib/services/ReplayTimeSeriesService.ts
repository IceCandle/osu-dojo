import { parseReplayToTimeSeries } from '../replay-parser';
import { getStorage } from '../core/storage';
import type { Attempt, Beatmap, Dan } from '@prisma/client';

/**
 * Time series data point for score progression
 */
export interface TimeSeriesPoint {
  time: number;
  score: number;
  combo: number;
  accuracy: number;
}

/**
 * Attempt loaded with related data
 */
export interface AttemptWithBeatmaps extends Attempt {
  dan: Dan & {
    beatmaps: Beatmap[];
  };
}

/**
 * Time series response DTO
 */
export interface TimeSeriesResponse {
  beatmapId: number;
  duration: number;
  finalScore: number;
  timeSeries: TimeSeriesPoint[];
  rivalName?: string;
  isThresholdOnly?: boolean;
  metadata?: {
    attemptId: number;
    totalScore: number;
    averageAccuracy: number | null;
    completedAt: Date;
  };
}

/**
 * Shared service for replay time-series operations
 * Handles parsing replays and normalizing responses for pacemaker overlay
 */
export class ReplayTimeSeriesService {
  /**
   * Parse replay file to time series with error handling
   * @throws Error if replay file not found or parsing fails
   */
  async parseReplay(
    replayKey: string,
    beatmapId: number,
    scoringSystem: 'LAZER' | 'SCORE_V2',
    context: string = 'ReplayParsing',
  ): Promise<TimeSeriesPoint[]> {
    const storage = getStorage();

    // Verify replay file exists
    const exists = await storage.exists(replayKey);
    if (!exists) {
      throw new Error(`Replay file not found: ${replayKey}`);
    }

    try {
      console.log(`[${context}] Parsing replay key: ${replayKey}`);
      const timeSeries = await parseReplayToTimeSeries(replayKey, beatmapId, scoringSystem);

      return timeSeries.map(({ time, score, combo, accuracy }) => ({
        time,
        score,
        combo,
        accuracy,
      }));
    } catch (error) {
      console.error(`[${context}] Replay parsing failed:`, error);
      throw new Error(
        `Failed to parse replay: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get map duration in milliseconds
   */
  getMapDuration(beatmap: Beatmap): number {
    return (beatmap.length || 180) * 1000;
  }

  /**
   * Normalize time series data to response format
   */
  normalizeResponse(
    beatmap: Beatmap,
    timeSeries: TimeSeriesPoint[],
    finalScore: number,
    rivalName?: string,
    metadata?: {
      attemptId: number;
      totalScore: number;
      averageAccuracy: number | null;
      completedAt: Date;
    },
  ): TimeSeriesResponse {
    return {
      beatmapId: beatmap.beatmapId,
      duration: this.getMapDuration(beatmap),
      finalScore,
      timeSeries,
      ...(rivalName && { rivalName }),
      ...(metadata && { metadata }),
    };
  }

  /**
   * Create threshold-only response (no time series, just a score line)
   * Used for clear mode where no replay exists
   */
  createThresholdResponse(
    beatmap: Beatmap,
    thresholdScore: number,
    rivalName: string,
  ): TimeSeriesResponse {
    return {
      beatmapId: beatmap.beatmapId,
      duration: this.getMapDuration(beatmap),
      finalScore: thresholdScore,
      timeSeries: [],
      rivalName,
      isThresholdOnly: true,
    };
  }
}

// Singleton export
export const replayTimeSeriesService = new ReplayTimeSeriesService();
