import { createLogger } from '@/lib/core/logger';
import { evaluateBeatmapRequirements } from '@/lib/beatmap-requirements';
import type { MapScore, MapConfig } from '@/types/bot-types';
import type { Redis } from 'ioredis';

/**
 * Service for processing and saving map scores
 *
 * Handles:
 * - Fetching live stats from overlay (sliderbreaks for osu!standard)
 * - Calculating effective misses (misses + sliderbreaks)
 * - Evaluating beatmap requirements
 * - Persisting scores to database
 *
 * @example
 * ```typescript
 * const processor = new ScoreProcessorService();
 * const result = await processor.processAndSaveScore(123, mapScore, mapConfig);
 * console.log(`Met requirement: ${result.metRequirement}`);
 * ```
 */
export class ScoreProcessorService {
  private logger = createLogger('ScoreProcessorService');

  /**
   * Process a map score and save it to the database
   *
   * @param attemptId - The attempt database ID
   * @param mapScore - The map score data from match
   * @param mapConfig - The map configuration with requirements
   * @returns Result with requirement check and effective misses
   */
  async processAndSaveScore(
    attemptId: number,
    mapScore: MapScore,
    mapConfig: MapConfig,
  ): Promise<{
    metRequirement: boolean;
    effectiveMisses: number;
    failed: Array<'score' | 'accuracy' | 'misses' | 'combo'>;
  }> {
    const { prisma } = await import('@/lib/core/prisma');
    const { redis } = await import('@/lib/core/redis');

    // Get sliderbreak data from overlay (OSU mode only)
    const { sliderbreaks, effectiveMisses, sliderbreaksSource } = await this.fetchLiveStats(
      attemptId,
      mapScore,
      mapConfig,
      redis,
    );

    // Evaluate beatmap requirements
    const requirementEval = evaluateBeatmapRequirements(
      {
        requiredScore: mapConfig.requiredScore,
        goldClearScore: mapConfig.goldClearScore,
        requiredAccuracy: mapConfig.requiredAccuracy ?? null,
        maxMisses: mapConfig.maxMisses ?? null,
        minCombo: mapConfig.minCombo ?? null,
        goldRequiredAccuracy: mapConfig.goldRequiredAccuracy ?? null,
        goldMaxMisses: mapConfig.goldMaxMisses ?? null,
        goldMinCombo: mapConfig.goldMinCombo ?? null,
      },
      {
        score: mapScore.score,
        accuracy: mapScore.accuracy,
        combo: mapScore.combo,
        countMiss: mapScore.countMiss,
        effectiveMisses,
      },
      'normal',
    );

    // Save to database
    await prisma.attemptScore.create({
      data: {
        attemptId,
        beatmapId: mapScore.beatmapId,
        score: mapScore.score,
        accuracy: mapScore.accuracy,
        combo: mapScore.combo,
        count300: mapScore.count300,
        count100: mapScore.count100,
        count50: mapScore.count50,
        countMiss: mapScore.countMiss,
        sliderbreaks,
        effectiveMisses,
        sliderbreaksSource,
        passed: mapScore.passed,
        metRequirement: requirementEval.met,
        modsUsed: mapConfig.mods,
        playedAt: new Date(),
      },
    });

    this.logger.info('Score saved to database', {
      attemptId,
      beatmapId: mapScore.beatmapId,
      score: mapScore.score.toString(),
      sliderbreaks,
      effectiveMisses,
      passed: mapScore.passed,
      metRequirement: requirementEval.met,
    });

    return {
      metRequirement: requirementEval.met,
      effectiveMisses,
      failed: requirementEval.failed,
    };
  }

  /**
   * Fetch live stats (sliderbreaks) from Redis overlay data
   * Only applicable for osu!standard mode
   */
  private async fetchLiveStats(
    attemptId: number,
    mapScore: MapScore,
    mapConfig: MapConfig,
    redis: Redis,
  ): Promise<{
    sliderbreaks: number;
    effectiveMisses: number;
    sliderbreaksSource: 'TOSU_OVERLAY' | 'UNKNOWN';
  }> {
    let sliderbreaks = 0;
    let effectiveMisses = mapScore.countMiss;
    let sliderbreaksSource: 'TOSU_OVERLAY' | 'UNKNOWN' = 'UNKNOWN';

    if (mapConfig.gameMode === 'OSU') {
      const liveStatsKey = `attempt:${attemptId}:live-stats:${mapConfig.beatmapId}`;
      const liveStatsData = await redis.get(liveStatsKey);

      if (liveStatsData) {
        try {
          const liveStats = JSON.parse(liveStatsData);
          sliderbreaks = liveStats.sliderbreaks || 0;
          effectiveMisses = mapScore.countMiss + sliderbreaks;
          sliderbreaksSource = 'TOSU_OVERLAY';

          this.logger.info('Sliderbreak data retrieved from overlay', {
            beatmapId: mapConfig.beatmapId,
            sliderbreaks,
            effectiveMisses,
          });

          // Clean up after reading
          await redis.del(liveStatsKey);
        } catch (error) {
          this.logger.warn('Failed to parse live stats data', { error, liveStatsKey });
        }
      } else {
        this.logger.warn('No sliderbreak data from overlay - recording as UNKNOWN', {
          beatmapId: mapConfig.beatmapId,
          note: 'AttemptScore.sliderbreaksSource=UNKNOWN; sliderbreaks default to 0',
        });
      }
    }

    return { sliderbreaks, effectiveMisses, sliderbreaksSource };
  }
}
