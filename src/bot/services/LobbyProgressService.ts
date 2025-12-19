import { createLogger } from '@/lib/core/logger';

/**
 * Service for syncing lobby progress to Redis and database
 *
 * Tracks current map index and completed maps count in both Redis (for bot recovery)
 * and database (for persistence).
 *
 * @example
 * ```typescript
 * const progressSync = new LobbyProgressService();
 * await progressSync.syncProgress(123, 456, 1, 1);
 * ```
 */
export class LobbyProgressService {
  private logger = createLogger('LobbyProgressService');

  /**
   * Sync current progress to Redis and database
   *
   * @param attemptId - The attempt database ID
   * @param multiplayerId - The multiplayer lobby ID (nullable)
   * @param currentMapIndex - Current map being played (0-indexed)
   * @param mapsCompleted - Number of maps with recorded scores
   */
  async syncProgress(
    attemptId: number,
    multiplayerId: string | null | undefined,
    currentMapIndex: number,
    mapsCompleted: number,
  ): Promise<void> {
    // Sync to Redis if multiplayerId exists
    if (multiplayerId) {
      await this.syncRedisState(multiplayerId, currentMapIndex, mapsCompleted);
    }

    // Sync to database
    await this.syncDatabaseState(attemptId, currentMapIndex, mapsCompleted);
  }

  /**
   * Update lobby state in Redis for crash recovery
   */
  private async syncRedisState(
    multiplayerId: string,
    currentMapIndex: number,
    mapsCompleted: number,
  ): Promise<void> {
    try {
      const { getLobbyState, saveLobbyState } = await import('../recovery');
      const state = await getLobbyState(multiplayerId);

      if (!state) {
        this.logger.warn('No lobby state found in Redis', { multiplayerId });
        return;
      }

      await saveLobbyState(multiplayerId, {
        ...state,
        currentMapIndex,
        mapsCompleted,
        lastHeartbeat: Date.now(),
      });

      this.logger.debug('Redis lobby state synced', {
        multiplayerId,
        currentMapIndex,
        mapsCompleted,
      });
    } catch (error) {
      this.logger.warn('Failed to sync Redis lobby state', { error, multiplayerId });
    }
  }

  /**
   * Update attempt progress in database
   */
  private async syncDatabaseState(
    attemptId: number,
    currentMapIndex: number,
    mapsCompleted: number,
  ): Promise<void> {
    try {
      const { prisma } = await import('@/lib/core/prisma');
      await prisma.attempt.update({
        where: { id: attemptId },
        data: {
          currentMapIndex,
          mapsCompleted,
        },
      });

      this.logger.debug('Database attempt progress synced', {
        attemptId,
        currentMapIndex,
        mapsCompleted,
      });
    } catch (error) {
      this.logger.warn('Failed to persist attempt progress', { error, attemptId });
    }
  }
}
