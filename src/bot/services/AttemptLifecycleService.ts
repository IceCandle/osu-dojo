import { createLogger } from '@/lib/core/logger';
import { evaluateBeatmapRequirements } from '@/lib/beatmap-requirements';
import type { MapScore, MapConfig } from '@/types/bot-types';

/**
 * Result of attempt completion
 */
export interface AttemptCompletionResult {
  status: 'COMPLETED' | 'ABANDONED';
  totalScore: bigint;
  averageAccuracy: number;
  isNormalPass: boolean;
  isGoldPass: boolean;
  mapsCompleted: number;
  totalMaps: number;
}

/**
 * Service for managing attempt lifecycle completion
 *
 * Handles:
 * - Calculating total score and average accuracy
 * - Two-tier clear evaluation (normal pass and gold pass)
 * - Determining final status (COMPLETED vs ABANDONED)
 * - Updating attempt in database
 * - Cleaning up Redis state
 *
 * @example
 * ```typescript
 * const lifecycle = new AttemptLifecycleService();
 * const result = await lifecycle.completeAttempt(123, 456, scores, mapConfigs);
 * console.log(`Normal pass: ${result.isNormalPass}, Gold pass: ${result.isGoldPass}`);
 * ```
 */
export class AttemptLifecycleService {
  private logger = createLogger('AttemptLifecycleService');

  /**
   * Complete an attempt and calculate final results
   *
   * @param attemptId - The attempt database ID
   * @param multiplayerId - The multiplayer lobby ID (nullable)
   * @param scores - All map scores from the attempt
   * @param mapConfigs - Map configurations with requirements
   * @returns Completion result with status and pass flags
   */
  async completeAttempt(
    attemptId: number,
    multiplayerId: string | null | undefined,
    scores: MapScore[],
    mapConfigs: MapConfig[],
  ): Promise<AttemptCompletionResult> {
    const { prisma } = await import('@/lib/core/prisma');
    const { deleteLobbyState } = await import('../recovery');

    const totalMaps = mapConfigs.length;
    const mapsCompleted = scores.length;

    // Calculate total score
    const totalScore = this.calculateTotalScore(scores);

    // Calculate average accuracy
    const averageAccuracy = this.calculateAverageAccuracy(scores);

    // Two-tier clear calculation
    const allMapsCompleted = mapsCompleted === totalMaps;
    const isNormalPass = this.evaluateNormalPass(allMapsCompleted, scores, mapConfigs);
    const isGoldPass = this.evaluateGoldPass(allMapsCompleted, scores, mapConfigs);

    // Determine final status
    const status = allMapsCompleted ? 'COMPLETED' : 'ABANDONED';

    this.logger.info('Completing attempt', {
      attemptId,
      totalScore: totalScore.toString(),
      averageAccuracy,
      isNormalPass,
      isGoldPass,
      status,
      mapsCompleted,
      totalMaps,
    });

    // Update attempt in database
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status,
        totalScore,
        averageAccuracy,
        isNormalPass,
        isGoldPass,
        completedAt: new Date(),
      },
    });

    // Clean up Redis state
    if (multiplayerId) {
      await deleteLobbyState(multiplayerId);
      this.logger.debug('Redis lobby state cleaned up', { multiplayerId });
    }

    return {
      status,
      totalScore,
      averageAccuracy,
      isNormalPass,
      isGoldPass,
      mapsCompleted,
      totalMaps,
    };
  }

  /**
   * Calculate total score across all maps
   */
  private calculateTotalScore(scores: MapScore[]): bigint {
    return scores.reduce((sum, s) => sum + s.score, BigInt(0));
  }

  /**
   * Calculate average accuracy across all maps
   */
  private calculateAverageAccuracy(scores: MapScore[]): number {
    if (scores.length === 0) return 0;
    return scores.reduce((sum, s) => sum + s.accuracy, 0) / scores.length;
  }

  /**
   * Evaluate if attempt meets normal pass requirements
   * All maps must be completed and meet normal requirements
   */
  private evaluateNormalPass(
    allMapsCompleted: boolean,
    scores: MapScore[],
    mapConfigs: MapConfig[],
  ): boolean {
    if (!allMapsCompleted) return false;

    return scores.every((s, index) => {
      const map = mapConfigs[index];
      const evalNormal = evaluateBeatmapRequirements(
        {
          requiredScore: map.requiredScore,
          goldClearScore: map.goldClearScore,
          requiredAccuracy: map.requiredAccuracy ?? null,
          maxMisses: map.maxMisses ?? null,
          minCombo: map.minCombo ?? null,
          goldRequiredAccuracy: map.goldRequiredAccuracy ?? null,
          goldMaxMisses: map.goldMaxMisses ?? null,
          goldMinCombo: map.goldMinCombo ?? null,
        },
        {
          score: s.score,
          accuracy: s.accuracy,
          combo: s.combo,
          countMiss: s.countMiss,
          effectiveMisses: s.effectiveMisses,
        },
        'normal',
      );
      return evalNormal.met;
    });
  }

  /**
   * Evaluate if attempt meets gold pass requirements
   * All maps must be completed and meet gold requirements
   */
  private evaluateGoldPass(
    allMapsCompleted: boolean,
    scores: MapScore[],
    mapConfigs: MapConfig[],
  ): boolean {
    if (!allMapsCompleted) return false;

    return scores.every((s, index) => {
      const map = mapConfigs[index];
      const evalGold = evaluateBeatmapRequirements(
        {
          requiredScore: map.requiredScore,
          goldClearScore: map.goldClearScore,
          requiredAccuracy: map.requiredAccuracy ?? null,
          maxMisses: map.maxMisses ?? null,
          minCombo: map.minCombo ?? null,
          goldRequiredAccuracy: map.goldRequiredAccuracy ?? null,
          goldMaxMisses: map.goldMaxMisses ?? null,
          goldMinCombo: map.goldMinCombo ?? null,
        },
        {
          score: s.score,
          accuracy: s.accuracy,
          combo: s.combo,
          countMiss: s.countMiss,
          effectiveMisses: s.effectiveMisses,
        },
        'gold',
      );
      return evalGold.met;
    });
  }
}
