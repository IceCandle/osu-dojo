/**
 * osu! Scoring System Implementation
 * Based on actual osu! source code and community research
 *
 * References:
 * - ScoreV1: https://osu.ppy.sh/wiki/en/Gameplay/Score/ScoreV1/osu!
 * - ScoreV2: https://github.com/ppy/osu (ScoreProcessor.cs)
 * - Lazer: https://github.com/ppy/osu/blob/master/osu.Game/Rulesets/Scoring/ScoreProcessor.cs
 */

/**
 * Base score values for hit judgements
 */
export const HIT_VALUES = {
  GREAT: 300,    // Perfect hit (300)
  OK: 100,       // Good hit (100)
  MEH: 50,       // Meh hit (50)
  MISS: 0,       // Miss
} as const;

/**
 * ScoreV2 Mod Multipliers
 * Applied to final 1,000,000 base score
 *
 * TODO: Add remaining multipliers
 * User will provide complete table later
 */
export const SCOREV2_MOD_MULTIPLIERS: Record<string, number> = {
  // Difficulty increasing
  'HD': 1.06,   // Hidden
  'HR': 1.10,   // Hard Rock
  'DT': 1.20,   // Double Time
  'NC': 1.20,   // Nightcore (same as DT)
  'FL': 1.12,   // Flashlight

  // Difficulty decreasing
  'NF': 1.00,   // No Fail (no penalty in V2!)
  'EZ': 0.50,   // Easy
  'HT': 0.30,   // Half Time
  'SO': 0.95,   // Spun Out

  // No multiplier
  'NM': 1.00,   // No Mod
  'SD': 1.00,   // Sudden Death
  'PF': 1.00,   // Perfect
  'RX': 1.00,   // Relax
  'AP': 1.00,   // Auto Pilot
  'Auto': 1.00, // Auto
};

/**
 * Calculate accuracy from hit counts (osu!standard)
 */
export function calculateAccuracy(
  count300: number,
  count100: number,
  count50: number,
  countMiss: number
): number {
  const totalHits = count300 + count100 + count50 + countMiss;
  if (totalHits === 0) return 1.0;

  const points = (count300 * 300) + (count100 * 100) + (count50 * 50);
  const maxPoints = totalHits * 300;

  return points / maxPoints; // Returns 0-1 decimal
}

/**
 * Get combined mod multiplier from array of mods
 */
export function getModMultiplier(mods: string[], scoringType: 'v1' | 'v2' = 'v2'): number {
  let multiplier = 1.0;

  if (scoringType === 'v2') {
    for (const mod of mods) {
      const modMultiplier = SCOREV2_MOD_MULTIPLIERS[mod.toUpperCase()];
      if (modMultiplier !== undefined) {
        multiplier *= modMultiplier;
      }
    }
  } else {
    // TODO: Add ScoreV1 multipliers when needed
    // V1 has different multipliers (NF=0.5, HD=1.06, etc.)
    multiplier = 1.0;
  }

  return multiplier;
}

/**
 * ScoreV2 Calculator
 * Based on actual osu! source code
 *
 * Algorithm (from runScoreV2 in osu! codebase):
 * 1. Calculate comboPortion: sum of (baseScore * (1 + combo / 10))
 * 2. Calculate accuracy from base scores
 * 3. Final score = 700,000 * (comboPortion / maxComboPortion) +
 *                  300,000 * (accuracy^10) * (hitsCompleted / totalHits)
 * 4. Apply mod multiplier to result
 *
 * Maximum: 1,000,000 points (before mods)
 */
export class ScoreV2Calculator {
  private maxCombo: number;
  private comboPortionMax: number;
  private maxBaseScore: number;

  constructor(maxCombo: number) {
    this.maxCombo = maxCombo;
    this.maxBaseScore = maxCombo * HIT_VALUES.GREAT;

    // Pre-calculate maximum combo portion (perfect play with all 300s)
    this.comboPortionMax = this.calculateMaxComboPortion();
  }

  /**
   * Calculate maximum combo portion (all 300s)
   */
  private calculateMaxComboPortion(): number {
    let comboPortion = 0;
    for (let combo = 1; combo <= this.maxCombo; combo++) {
      comboPortion += HIT_VALUES.GREAT * (1 + combo / 10.0);
    }
    return comboPortion;
  }

  /**
   * Calculate ScoreV2 from hit counts
   * Simulates the play and calculates combo progression
   *
   * @param count300 - Number of 300s
   * @param count100 - Number of 100s
   * @param count50 - Number of 50s
   * @param countMiss - Number of misses
   * @param modMultiplier - Mod multiplier (default 1.0)
   * @returns Final ScoreV2 value
   */
  calculateScore(
    count300: number,
    count100: number,
    count50: number,
    countMiss: number,
    modMultiplier: number = 1.0
  ): number {
    let currentCombo = 0;
    let comboPortion = 0;
    let currentBaseScore = 0;
    const currentHits = count300 + count100 + count50 + countMiss;

    // Simulate hits in order
    // NOTE: We don't know actual hit order, so we assume best case
    // (all 300s first, then 100s, then 50s, then misses)

    // Process 300s
    for (let i = 0; i < count300; i++) {
      currentBaseScore += HIT_VALUES.GREAT;
      currentCombo++;
      comboPortion += HIT_VALUES.GREAT * (1 + currentCombo / 10.0);
    }

    // Process 100s
    for (let i = 0; i < count100; i++) {
      currentBaseScore += HIT_VALUES.OK;
      currentCombo++;
      comboPortion += HIT_VALUES.OK * (1 + currentCombo / 10.0);
    }

    // Process 50s
    for (let i = 0; i < count50; i++) {
      currentBaseScore += HIT_VALUES.MEH;
      currentCombo++;
      comboPortion += HIT_VALUES.MEH * (1 + currentCombo / 10.0);
    }

    // Process misses (resets combo, contributes to maxBaseScore but not currentBaseScore)
    // Note: Misses are handled by not incrementing currentBaseScore or combo

    // Calculate accuracy
    const accuracy = this.maxBaseScore > 0 ? currentBaseScore / this.maxBaseScore : 0;

    // Apply ScoreV2 formula
    const comboPart = 700000 * (comboPortion / this.comboPortionMax);
    const accuracyPart = 300000 * Math.pow(accuracy, 10) * (currentHits / this.maxCombo);

    const baseScore = comboPart + accuracyPart;

    // Apply mod multiplier to final score
    return Math.round(baseScore * modMultiplier);
  }

  /**
   * Calculate score at specific progress point
   * Used for pacemaker time-series generation
   *
   * @param objectsCompleted - Number of objects hit so far
   * @param count300 - 300s hit so far
   * @param count100 - 100s hit so far
   * @param count50 - 50s hit so far
   * @param countMiss - Misses so far
   * @param modMultiplier - Mod multiplier
   * @returns Score at this point in time
   */
  calculateProgressScore(
    objectsCompleted: number,
    count300: number,
    count100: number,
    count50: number,
    countMiss: number,
    modMultiplier: number = 1.0
  ): number {
    let comboPortion = 0;
    let currentBaseScore = 0;
    let combo = 0;

    // Simulate combo growth (assuming hits in order: 300s, 100s, 50s)
    for (let i = 0; i < count300; i++) {
      currentBaseScore += HIT_VALUES.GREAT;
      combo++;
      comboPortion += HIT_VALUES.GREAT * (1 + combo / 10.0);
    }

    for (let i = 0; i < count100; i++) {
      currentBaseScore += HIT_VALUES.OK;
      combo++;
      comboPortion += HIT_VALUES.OK * (1 + combo / 10.0);
    }

    for (let i = 0; i < count50; i++) {
      currentBaseScore += HIT_VALUES.MEH;
      combo++;
      comboPortion += HIT_VALUES.MEH * (1 + combo / 10.0);
    }

    const accuracy = this.maxBaseScore > 0 ? currentBaseScore / this.maxBaseScore : 0;

    const comboPart = 700000 * (comboPortion / this.comboPortionMax);
    const accuracyPart = 300000 * Math.pow(accuracy, 10) * (objectsCompleted / this.maxCombo);

    return Math.round((comboPart + accuracyPart) * modMultiplier);
  }
}

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
    bonusPortion: number = 0
  ): number {
    const comboProgress = this.maxComboPortion > 0
      ? currentComboPortion / this.maxComboPortion
      : 1;

    const accuracyProgress = this.maxAccuracyJudgementCount > 0
      ? currentAccuracyJudgementCount / this.maxAccuracyJudgementCount
      : 1;

    const comboPart = 500000 * accuracy * comboProgress;
    const accuracyPart = 500000 * Math.pow(accuracy, 5) * accuracyProgress;

    return Math.floor(comboPart + accuracyPart + bonusPortion);
  }
}

/**
 * ScoreV1 Calculator (Legacy Scoring)
 * Based on classic osu! scoring with exponential combo scaling
 *
 * Formula: Score = HitValue * (1 + (ComboMultiplier * DifficultyMultiplier * ModMultiplier / 25))
 *
 * Note: This is kept for reference but ScoreV2 is recommended for dan testing
 */
export class ScoreV1Calculator {
  private difficultyMultiplier: number;

  constructor(
    hp: number,
    cs: number,
    od: number,
    objectCount: number,
    drainTimeSeconds: number
  ) {
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
    const score = hitValue * (1 + (comboMultiplier * this.difficultyMultiplier * modMultiplier / 25));
    return Math.floor(score);
  }
}
