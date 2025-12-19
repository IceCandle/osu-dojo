/**
 * osu! Scoring System Service
 *
 * incorrect in many places
 */

/**
 * Base score values for hit judgements
 */
export const HIT_VALUES = {
  GREAT: 300, // Perfect hit (300)
  OK: 100, // Good hit (100)
  MEH: 50, // Meh hit (50)
  MISS: 0, // Miss
} as const;

/**
 * ScoreV2 Mod Multipliers
 * Applied to final 1,000,000 base score
 *
 * TODO: Verify with osu! - some values may need adjustment
 */
export const SCOREV2_MOD_MULTIPLIERS: Record<string, number> = {
  // Difficulty increasing
  HD: 1.06, // Hidden
  HR: 1.1, // Hard Rock
  DT: 1.2, // Double Time
  NC: 1.2, // Nightcore
  FL: 1.12, // Flashlight

  // Difficulty decreasing
  NF: 1.0, // No Fail
  EZ: 0.5, // Easy
  HT: 0.3, // Half Time
  SO: 0.95, // Spun Out

  // No multiplier
  NM: 1.0, // No Mod
  SD: 1.0, // Sudden Death
  PF: 1.0, // Perfect
};

export const SCOREV1_MOD_MULTIPLIERS: Record<string, number> = {
  // Difficulty increasing
  HD: 1.06,
  HR: 1.06,
  DT: 1.12,
  FL: 1.12,

  // Difficulty decreasing
  NF: 0.5,
  EZ: 0.5,
  HT: 0.3,

  // No multiplier
  NM: 1.0,
};

export const LAZER_MOD_MULTIPLIERS: Record<string, number> = {
  // Difficulty increasing
  HD: 1.06,
  HR: 1.06,
  DT: 1.1,
  FL: 1.12,

  // Difficulty decreasing
  NF: 0.5,
  EZ: 0.5,
  HT: 0.3,

  // No multiplier
  NM: 1.0,
};

/**
 * Lazer Scoring Calculator
 * Based on new osu!lazer client scoring system
 *
 * Formula:
 * Score = 500,000 * Accuracy * ComboProgress +
 *         500,000 * Accuracy^5 * AccuracyProgress +
 *         BonusPortion
 *
 * Maximum: 1,000,000 points
 */
export class LazerScoreCalculator {
  private maxComboPortion: number;
  private maxAccuracyJudgementCount: number;

  constructor(maxCombo: number, objectCount: number) {
    this.maxComboPortion = maxCombo;
    this.maxAccuracyJudgementCount = objectCount;
  }

  /**
   * Calculate Lazer score
   *
   * @param accuracy - Accuracy as decimal (0-1)
   * @param currentComboPortion - Current combo achieved
   * @param currentAccuracyJudgementCount - Number of objects judged so far
   * @param bonusPortion - Bonus points (spinners, etc.)
   * @returns Final score
   */
  calculateScore(
    accuracy: number,
    currentComboPortion: number,
    currentAccuracyJudgementCount: number,
    bonusPortion: number = 0,
  ): number {
    const comboProgress = this.maxComboPortion > 0 ? currentComboPortion / this.maxComboPortion : 1;

    const accuracyProgress =
      this.maxAccuracyJudgementCount > 0
        ? currentAccuracyJudgementCount / this.maxAccuracyJudgementCount
        : 1;

    const comboPart = 500000 * accuracy * comboProgress;
    const accuracyPart = 500000 * Math.pow(accuracy, 5) * accuracyProgress;

    return Math.floor(comboPart + accuracyPart + bonusPortion);
  }
}

/**
 * ScoreV1 Calculator (Legacy Scoring)
 */
export class ScoreV1Calculator {
  private difficultyMultiplier: number;

  constructor(hp: number, cs: number, od: number, objectCount: number, drainTimeSeconds: number) {
    // Calculate difficulty multiplier
    // Formula: Round((HP + CS + OD + Clamp(ObjectCount / DrainTime * 8, 0, 16)) / 38 * 5)
    const densityFactor = Math.min(Math.max((objectCount / drainTimeSeconds) * 8, 0), 16);
    this.difficultyMultiplier = Math.round(((hp + cs + od + densityFactor) / 38) * 5);
  }

  /**
   * Calculate score for a single hit
   */
  calculateHitScore(hitValue: number, comboBeforeHit: number, modMultiplier: number = 1.0): number {
    const comboMultiplier = Math.max(comboBeforeHit - 1, 0);
    const score =
      hitValue * (1 + (comboMultiplier * this.difficultyMultiplier * modMultiplier) / 25);
    return Math.floor(score);
  }
}

function roundToEven(value: number): number {
  if (!Number.isFinite(value)) return 0;

  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);

  const floor = Math.floor(abs);
  const frac = abs - floor;

  if (frac < 0.5) return sign * floor;
  if (frac > 0.5) return sign * (floor + 1);

  // Exactly halfway: round to even.
  return sign * (floor % 2 === 0 ? floor : floor + 1);
}

/**
 * ScoreV2 Calculator (Tournament Scoring)
 *
 * Implemented to match the reference algorithm provided by the user.
 *
 * Notes:
 * - Mod multipliers are applied to the final score.
 * - Rounding matches .NET Math.Round (banker's rounding / midpoint-to-even).
 */
export class ScoreV2Calculator {
  private currentCombo = 0;
  private comboPortion = 0;
  private currentBaseScore = 0;
  private maxBaseScore = 0;
  private currentHits = 0;

  private readonly modMultiplier: number;
  private readonly comboPortionMax: number;
  private readonly maxCombo: number;

  constructor(maxCombo: number, mods: string[]) {
    this.maxCombo = Math.max(0, Math.trunc(maxCombo));
    this.modMultiplier = scoringService.getModMultiplier(mods, 'v2');

    // Compute comboPortionMax by simulating a perfect play (all GREAT) of length maxCombo.
    // Kept as a loop to mirror the reference implementation.
    let simCombo = 0;
    let simComboPortion = 0;
    for (let i = 0; i < this.maxCombo; i++) {
      simComboPortion += HIT_VALUES.GREAT * (1 + ++simCombo / 10.0);
    }
    this.comboPortionMax = simComboPortion;
  }

  applyHit(): void {
    this.applyHitV2(HIT_VALUES.GREAT);
  }

  applyNonPerfect(): void {
    this.applyHitV2(HIT_VALUES.OK);
  }

  private applyHitV2(baseScore: number): void {
    this.maxBaseScore += HIT_VALUES.GREAT;
    this.currentBaseScore += baseScore;
    this.comboPortion += baseScore * (1 + ++this.currentCombo / 10.0);
    this.currentHits++;
  }

  applyMiss(): void {
    this.currentHits++;
    this.maxBaseScore += HIT_VALUES.GREAT;
    this.currentCombo = 0;
  }

  get totalScore(): bigint {
    if (this.maxCombo <= 0) return 0n;
    if (this.comboPortionMax <= 0) return 0n;

    const accuracy = this.maxBaseScore > 0 ? this.currentBaseScore / this.maxBaseScore : 0;
    const hitProgress = this.currentHits / this.maxCombo;

    const raw =
      (700000 * (this.comboPortion / this.comboPortionMax) +
        300000 * Math.pow(accuracy, 10) * hitProgress) *
      this.modMultiplier;

    return BigInt(roundToEven(raw));
  }
}

export type AccuracyModel = 'STABLE' | 'SCORE_V2' | 'LAZER';

/**
 * Scoring Service
 *
 * Provides utilities for calculating scores and accuracy across different
 * osu! scoring systems (ScoreV1, ScoreV2, Lazer).
 *
 * @example
 * ```typescript
 * import { scoringService } from '@/lib/services/ScoringService';
 *
 * const accuracy = scoringService.calculateAccuracy(300, 50, 10, 2);
 * const multiplier = scoringService.getModMultiplier(['HD', 'DT'], 'v2');
 * ```
 */
export class ScoringService {
  /**
   * Calculate accuracy from hit counts (osu!stable displayed accuracy)
   *
   * This is the traditional osu!standard accuracy formula used for score displays:
   * (300*n300 + 100*n100 + 50*n50) / (300*(n300+n100+n50+nmiss))
   *
   * @param count300 - Number of perfect hits
   * @param count100 - Number of good hits
   * @param count50 - Number of meh hits
   * @param countMiss - Number of misses
   * @returns Accuracy as decimal (0-1)
   */
  calculateAccuracy(
    count300: number,
    count100: number,
    count50: number,
    countMiss: number,
  ): number {
    const totalHits = count300 + count100 + count50 + countMiss;
    if (totalHits === 0) return 1.0;

    const points = count300 * 300 + count100 * 100 + count50 * 50;
    const maxPoints = totalHits * 300;

    return points / maxPoints; // Returns 0-1 decimal
  }

  /**
   * Calculate the accuracy term used by the ScoreV2 scoring formula.
   *
   * IMPORTANT:
   * The reference ScoreV2 algorithm applies only GREAT (300) and OK (100) base scores.
   * Since osu!stable provides separate 100 and 50 counts, we treat *any* non-300 hit
   * (100 + 50) as OK for the purpose of the ScoreV2 accuracy term.
   */
  calculateScoreV2ScoringAccuracy(
    count300: number,
    count100: number,
    count50: number,
    countMiss: number,
  ): number {
    const totalHits = count300 + count100 + count50 + countMiss;
    if (totalHits === 0) return 1.0;

    const points = count300 * HIT_VALUES.GREAT + (count100 + count50) * HIT_VALUES.OK;
    const maxPoints = totalHits * HIT_VALUES.GREAT;
    return points / maxPoints;
  }

  /**
   * Calculate the accuracy term used by the Lazer scoring formula.
   *
   * For osu!standard, this matches the classic hit-value ratio when you only have
   * 300/100/50/miss counts available.
   */
  calculateLazerScoringAccuracy(
    count300: number,
    count100: number,
    count50: number,
    countMiss: number,
  ): number {
    return this.calculateAccuracy(count300, count100, count50, countMiss);
  }

  /**
   * Convenience: choose an accuracy model.
   *
   * - STABLE: displayed accuracy (classic osu!stable formula)
   * - SCORE_V2: accuracy term used inside the ScoreV2 score formula
   * - LAZER: accuracy term used inside the Lazer score formula
   */
  calculateAccuracyByModel(
    model: AccuracyModel,
    count300: number,
    count100: number,
    count50: number,
    countMiss: number,
  ): number {
    switch (model) {
      case 'SCORE_V2':
        return this.calculateScoreV2ScoringAccuracy(count300, count100, count50, countMiss);
      case 'LAZER':
        return this.calculateLazerScoringAccuracy(count300, count100, count50, countMiss);
      case 'STABLE':
      default:
        return this.calculateAccuracy(count300, count100, count50, countMiss);
    }
  }

  /**
   * Get combined mod multiplier from array of mods
   *
   * @param mods - Array of mod abbreviations (e.g., ['HD', 'DT'])
   * @param scoringType - Scoring system version ('v1' or 'v2')
   * @returns Combined multiplier
   */
  getModMultiplier(mods: string[], scoringType: 'v1' | 'v2' | 'lazer' = 'v2'): number {
    let multiplier = 1.0;

    if (scoringType === 'v2') {
      for (const mod of mods) {
        const modMultiplier = SCOREV2_MOD_MULTIPLIERS[mod.toUpperCase()];
        if (modMultiplier !== undefined) {
          multiplier *= modMultiplier;
        }
      }
    } else if (scoringType === 'v1') {
      for (const mod of mods) {
        const modMultiplier = SCOREV1_MOD_MULTIPLIERS[mod.toUpperCase()];
        if (modMultiplier !== undefined) {
          multiplier *= modMultiplier;
        }
      }
    } else if (scoringType === 'lazer') {
      for (const mod of mods) {
        const modMultiplier = LAZER_MOD_MULTIPLIERS[mod.toUpperCase()];
        if (modMultiplier !== undefined) {
          multiplier *= modMultiplier;
        }
      }
    }

    return multiplier;
  }

  /**
   * Create a Lazer score calculator instance
   *
   * @param maxCombo - Maximum possible combo
   * @param objectCount - Total number of hit objects
   * @returns LazerScoreCalculator instance
   */
  createLazerCalculator(maxCombo: number, objectCount: number): LazerScoreCalculator {
    return new LazerScoreCalculator(maxCombo, objectCount);
  }

  /**
   * Create a ScoreV1 calculator instance
   *
   * @param hp - HP drain rate
   * @param cs - Circle size
   * @param od - Overall difficulty
   * @param objectCount - Total number of hit objects
   * @param drainTimeSeconds - Drain time in seconds
   * @returns ScoreV1Calculator instance
   */
  createV1Calculator(
    hp: number,
    cs: number,
    od: number,
    objectCount: number,
    drainTimeSeconds: number,
  ): ScoreV1Calculator {
    return new ScoreV1Calculator(hp, cs, od, objectCount, drainTimeSeconds);
  }

  /**
   * Create a ScoreV2 calculator instance
   *
   * @param maxCombo - Maximum possible combo
   * @param mods - Array of mod abbreviations (e.g., ['HD', 'DT'])
   */
  createV2Calculator(maxCombo: number, mods: string[]): ScoreV2Calculator {
    return new ScoreV2Calculator(maxCombo, mods);
  }
}

// Singleton export
export const scoringService = new ScoringService();

// For backward compatibility, also export individual functions
export const calculateAccuracy = scoringService.calculateAccuracy.bind(scoringService);
export const getModMultiplier = scoringService.getModMultiplier.bind(scoringService);
