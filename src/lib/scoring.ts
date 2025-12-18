/**
 * osu! Scoring System Implementation
 * Based on actual osu! source code and community research
 *
 * References:
 * - ScoreV1: https://osu.ppy.sh/wiki/en/Gameplay/Score/ScoreV1/osu!
 * - ScoreV2: Nowhere to be found, different from lazer
 * - Lazer: https://github.com/ppy/osu/blob/master/osu.Game/Rulesets/Scoring/ScoreProcessor.cs
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
 * TODO: Verify with osu!
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
  NM: 1.0
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
  NM: 1.0
};

/**
 * Calculate accuracy from hit counts (osu!standard)
 */
export function calculateAccuracy(
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
    // TODO: Add ScoreV1 and lazer multipliers when needed
    // V1 has different multipliers (NF=0.5, HD=1.06, etc.)
    multiplier = 1.0;
  }

  return multiplier;
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
 * Based on classic osu! scoring with exponential combo scaling
 *
 * Formula: Score = HitValue * (1 + (ComboMultiplier * DifficultyMultiplier * ModMultiplier / 25))
 *
 * Note: This is kept for reference but ScoreV2 is recommended for dan testing
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
