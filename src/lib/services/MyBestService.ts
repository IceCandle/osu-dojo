import { prisma } from '../core/prisma';
import { replayTimeSeriesService, type TimeSeriesResponse } from './ReplayTimeSeriesService';

/**
 * Service for retrieving user's previous best attempt time series
 * Used by pacemaker overlay to show MY-BEST comparison bar
 */
export class MyBestService {
  /**
   * Get time series data for user's previous best attempt on the same dan
   * @param attemptId Current attempt ID
   * @returns Time series response with replay data and metadata
   * @throws Error if attempt not found, no current beatmap, or no previous attempts exist
   */
  async getMyBestTimeSeries(attemptId: number): Promise<TimeSeriesResponse> {
    // Load current attempt with dan and beatmaps
    const currentAttempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        dan: {
          include: {
            beatmaps: {
              orderBy: {
                orderIndex: 'asc',
              },
            },
          },
        },
      },
    });

    if (!currentAttempt) {
      throw new Error('Attempt not found');
    }

    // Get the current map being played
    const currentBeatmap = currentAttempt.dan.beatmaps[currentAttempt.currentMapIndex];

    if (!currentBeatmap) {
      throw new Error('Current beatmap not found');
    }

    // Query for user's previous best attempts on this dan
    const previousAttempts = await prisma.attempt.findMany({
      where: {
        userId: currentAttempt.userId,
        danId: currentAttempt.danId,
        status: 'COMPLETED',
        id: { not: attemptId }, // Exclude current attempt
      },
      include: {
        scores: {
          where: {
            beatmapId: currentBeatmap.id, // DB primary key
          },
          include: {
            beatmap: true,
          },
        },
        replays: {
          where: {
            beatmapId: currentBeatmap.id, // Filter to current map's replay
          },
        },
      },
      orderBy: {
        totalScore: 'desc',
      },
      take: 1,
    });

    // No previous attempts found
    if (previousAttempts.length === 0 || !previousAttempts[0].scores[0]) {
      throw new Error('No previous attempts found for this beatmap');
    }

    const bestAttempt = previousAttempts[0];
    const bestScore = bestAttempt.scores[0];
    const replayKey = bestAttempt.replays[0]?.filePath;

    if (!replayKey) {
      throw new Error('Replay file not found for best attempt');
    }

    // Parse replay file
    const timeSeries = await replayTimeSeriesService.parseReplay(
      replayKey,
      currentBeatmap.beatmapId,
      currentBeatmap.scoringSystem === 'LAZER' ? 'LAZER' : 'SCORE_V2',
      'MyBest',
    );

    // Return normalized response
    return replayTimeSeriesService.normalizeResponse(
      currentBeatmap,
      timeSeries,
      Number(bestScore.score),
      undefined, // No rivalName for my-best
      {
        attemptId: bestAttempt.id,
        totalScore: Number(bestAttempt.totalScore),
        averageAccuracy: bestAttempt.averageAccuracy,
        completedAt: bestAttempt.updatedAt,
      },
    );
  }
}

// Singleton export
export const myBestService = new MyBestService();
