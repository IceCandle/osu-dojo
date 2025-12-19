import { prisma } from '../core/prisma';
import { replayTimeSeriesService, type TimeSeriesResponse } from './ReplayTimeSeriesService';
import type { Beatmap, Attempt, Dan, Replay, AttemptScore } from '@prisma/client';

/**
 * Supported rival modes for pacemaker comparison
 */
export type RivalMode = 'clear' | 'gold-clear' | 'national' | 'friends' | 'same-rank' | 'rotate';

/**
 * Attempt with nested relations for rival resolution
 */
type AttemptWithRelations = Attempt & {
  dan: Dan & {
    beatmaps: Beatmap[];
    goldClearReplay:
      | (Replay & {
          attempt: Attempt & {
            scores: (AttemptScore & {
              beatmap: Beatmap;
            })[];
          };
        })
      | null;
  };
};

/**
 * Service for retrieving rival score time series based on selected mode
 * Used by pacemaker overlay to show RIVAL comparison bar
 */
export class RivalScoreService {
  /**
   * Get rival time series data based on mode
   * @param attemptId Current attempt ID
   * @param mode Rival mode (clear, gold-clear, national, friends, same-rank, rotate)
   * @returns Time series response with rival replay data
   * @throws Error if attempt not found, mode not implemented, or replay unavailable
   */
  async getRivalTimeSeries(attemptId: number, mode: RivalMode): Promise<TimeSeriesResponse> {
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
            goldClearReplay: {
              include: {
                attempt: {
                  include: {
                    scores: {
                      include: {
                        beatmap: true,
                      },
                    },
                  },
                },
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

    // Route to appropriate handler based on mode
    switch (mode) {
      case 'clear':
        return this.getClearThreshold(currentBeatmap);

      case 'gold-clear':
        return this.getGoldClearReplay(currentAttempt, currentBeatmap);

      case 'national':
        return this.getNationalBest(currentAttempt, currentBeatmap, attemptId);

      case 'friends':
      case 'same-rank':
      case 'rotate':
        throw new Error(
          `Rival mode '${mode}' not yet implemented. Friend system is coming in a future update.`,
        );

      default:
        throw new Error(
          `Invalid rival mode: ${mode}. Valid modes: clear, gold-clear, national, friends, same-rank, rotate`,
        );
    }
  }

  /**
   * Clear mode: Return threshold score (no replay, just a score line)
   */
  private getClearThreshold(currentBeatmap: Beatmap): TimeSeriesResponse {
    const clearScore = Number(currentBeatmap.requiredScore);

    return replayTimeSeriesService.createThresholdResponse(
      currentBeatmap,
      clearScore,
      'Clear Threshold',
    );
  }

  /**
   * Gold clear mode: Return dan gold clear replay
   */
  private async getGoldClearReplay(
    currentAttempt: AttemptWithRelations,
    currentBeatmap: Beatmap,
  ): Promise<TimeSeriesResponse> {
    if (!currentAttempt.dan.goldClearReplay) {
      throw new Error('No gold clear replay available for this dan');
    }

    const replayKey = currentAttempt.dan.goldClearReplay.filePath;

    if (!replayKey) {
      throw new Error('Gold clear replay file path not found');
    }

    // Parse replay file
    const timeSeries = await replayTimeSeriesService.parseReplay(
      replayKey,
      currentBeatmap.beatmapId,
      currentBeatmap.scoringSystem === 'LAZER' ? 'LAZER' : 'SCORE_V2',
      'Rival:GoldClear',
    );

    // Get final score from parsed time series
    const finalScore = timeSeries[timeSeries.length - 1]?.score || 0;

    return replayTimeSeriesService.normalizeResponse(
      currentBeatmap,
      timeSeries,
      finalScore,
      'Gold Clear',
    );
  }

  /**
   * National mode: Return top score from leaderboard for this beatmap
   */
  private async getNationalBest(
    currentAttempt: AttemptWithRelations,
    currentBeatmap: Beatmap,
    attemptId: number,
  ): Promise<TimeSeriesResponse> {
    // Query top score from leaderboard for this beatmap
    const topAttempt = await prisma.attempt.findFirst({
      where: {
        danId: currentAttempt.danId,
        status: 'COMPLETED',
        id: { not: attemptId },
      },
      include: {
        scores: {
          where: {
            beatmapId: currentBeatmap.id,
          },
        },
        user: true,
        replays: {
          where: {
            beatmapId: currentBeatmap.id, // Filter to current map's replay
          },
        },
      },
      orderBy: {
        totalScore: 'desc',
      },
    });

    if (!topAttempt || !topAttempt.scores[0]) {
      throw new Error('No national scores found for this beatmap');
    }

    const topScore = topAttempt.scores[0];
    const replayKey = topAttempt.replays[0]?.filePath;

    if (!replayKey) {
      throw new Error('Replay file not found for national best attempt');
    }

    // Parse replay file
    const timeSeries = await replayTimeSeriesService.parseReplay(
      replayKey,
      currentBeatmap.beatmapId,
      currentBeatmap.scoringSystem === 'LAZER' ? 'LAZER' : 'SCORE_V2',
      'Rival:National',
    );

    return replayTimeSeriesService.normalizeResponse(
      currentBeatmap,
      timeSeries,
      Number(topScore.score),
      `#1 ${topAttempt.user.osuUsername || 'National'}`,
    );
  }
}

// Singleton export
export const rivalScoreService = new RivalScoreService();
