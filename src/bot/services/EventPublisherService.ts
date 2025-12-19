import { createLogger } from '@/lib/core/logger';

/**
 * Service for publishing attempt lifecycle events to Redis Pub/Sub
 *
 * Handles all event publishing for multiplayer lobby events, centralizing
 * error handling and logging.
 *
 * @example
 * ```typescript
 * const eventPublisher = new EventPublisherService();
 * await eventPublisher.publishAttemptStarted(123, {
 *   username: 'player',
 *   danName: 'DDMythical Reform Alpha',
 *   beatmapId: 123456,
 * });
 * ```
 */
export class EventPublisherService {
  private logger = createLogger('EventPublisherService');

  /**
   * Publish ATTEMPT_STARTED event
   * Called when the first map begins
   */
  async publishAttemptStarted(
    attemptId: number,
    data: {
      multiplayerId: string | null | undefined;
      username: string;
      danName: string;
      beatmapId: number;
    },
  ): Promise<void> {
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');
      await publishAttemptEvent(attemptId, 'ATTEMPT_STARTED', {
        attemptId,
        multiplayerId: data.multiplayerId,
        username: data.username,
        danName: data.danName,
        beatmapId: data.beatmapId,
        mapIndex: 0,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.warn('Failed to publish ATTEMPT_STARTED event', { error, attemptId });
    }
  }

  /**
   * Publish MAP_CHANGED event
   * Called each time a new map starts
   */
  async publishMapChanged(
    attemptId: number,
    data: {
      currentMapIndex: number;
      totalMaps: number;
      beatmapId: number;
      beatmapName: string;
      mods: string[];
      requiredScore: bigint;
      goldClearScore: bigint;
      skillFocus: string | null;
      gameMode: string;
    },
  ): Promise<void> {
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');
      await publishAttemptEvent(attemptId, 'MAP_CHANGED', {
        attemptId,
        currentMapIndex: data.currentMapIndex,
        totalMaps: data.totalMaps,
        beatmapId: data.beatmapId,
        beatmapName: data.beatmapName,
        mods: data.mods,
        requiredScore: data.requiredScore.toString(),
        goldClearScore: data.goldClearScore.toString(),
        skillFocus: data.skillFocus,
        gameMode: data.gameMode,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.warn('Failed to publish MAP_CHANGED event', { error, attemptId });
    }
  }

  /**
   * Publish SCORE_UPDATE event
   * Called after each map score is saved to database
   */
  async publishScoreUpdate(
    attemptId: number,
    data: {
      beatmapId: number;
      score: bigint;
      accuracy: number;
      combo: number;
      passed: boolean;
      metRequirement: boolean;
      currentMapIndex: number;
      mapsCompleted: number;
    },
  ): Promise<void> {
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');
      await publishAttemptEvent(attemptId, 'SCORE_UPDATE', {
        attemptId,
        beatmapId: data.beatmapId,
        score: data.score.toString(),
        accuracy: data.accuracy,
        combo: data.combo,
        passed: data.passed,
        metRequirement: data.metRequirement,
        currentMapIndex: data.currentMapIndex,
        mapsCompleted: data.mapsCompleted,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.warn('Failed to publish SCORE_UPDATE event', { error, attemptId });
    }
  }

  /**
   * Publish ATTEMPT_FAILED event
   * Called when player disconnects, fails a map, or bot shuts down
   */
  async publishAttemptFailed(
    attemptId: number,
    data:
      | {
          reason: 'player_disconnected' | 'graceful_shutdown';
          currentMapIndex: number;
          mapsCompleted: number;
        }
      | {
          reason: 'did_not_complete';
          failedAtMapIndex: number;
          totalMaps: number;
          score: bigint;
          requiredScore: bigint;
        },
  ): Promise<void> {
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');

      if (data.reason === 'did_not_complete') {
        await publishAttemptEvent(attemptId, 'ATTEMPT_FAILED', {
          attemptId,
          failedAtMapIndex: data.failedAtMapIndex,
          totalMaps: data.totalMaps,
          failReason: 'did_not_complete',
          score: data.score.toString(),
          requiredScore: data.requiredScore.toString(),
          timestamp: Date.now(),
        });
      } else {
        await publishAttemptEvent(attemptId, 'ATTEMPT_FAILED', {
          attemptId,
          reason: data.reason,
          currentMapIndex: data.currentMapIndex,
          mapsCompleted: data.mapsCompleted,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      this.logger.warn('Failed to publish ATTEMPT_FAILED event', { error, attemptId });
    }
  }

  /**
   * Publish ATTEMPT_COMPLETED event
   * Called when attempt finishes (completed or abandoned)
   */
  async publishAttemptCompleted(
    attemptId: number,
    data: {
      status: 'COMPLETED' | 'ABANDONED';
      totalScore: bigint;
      averageAccuracy: number;
      isNormalPass: boolean;
      isGoldPass: boolean;
      mapsCompleted: number;
      totalMaps: number;
    },
  ): Promise<void> {
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');
      await publishAttemptEvent(attemptId, 'ATTEMPT_COMPLETED', {
        attemptId,
        status: data.status,
        totalScore: data.totalScore.toString(),
        averageAccuracy: data.averageAccuracy,
        isNormalPass: data.isNormalPass,
        isGoldPass: data.isGoldPass,
        mapsCompleted: data.mapsCompleted,
        totalMaps: data.totalMaps,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.warn('Failed to publish ATTEMPT_COMPLETED event', { error, attemptId });
    }
  }
}
