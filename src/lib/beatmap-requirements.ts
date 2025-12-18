export type RequirementTier = 'normal' | 'gold';

export interface BeatmapRequirementConfig {
  requiredScore: bigint;
  goldClearScore: bigint;

  requiredAccuracy?: number | null;
  maxMisses?: number | null;
  minCombo?: number | null;

  goldRequiredAccuracy?: number | null;
  goldMaxMisses?: number | null;
  goldMinCombo?: number | null;
}

export interface PlayMetrics {
  score: bigint;
  accuracy: number; // 0-100
  combo: number;
  countMiss: number;
  /** For osu!standard, prefer effectiveMisses (misses + sliderbreaks) when available. */
  effectiveMisses?: number;
}

export interface RequirementEvaluation {
  met: boolean;
  failed: Array<'score' | 'accuracy' | 'misses' | 'combo'>;
}

function getTierField<T>(
  tier: RequirementTier,
  normal: T | null | undefined,
  gold: T | null | undefined,
): T | null | undefined {
  return tier === 'gold' ? gold : normal;
}

export function evaluateBeatmapRequirements(
  beatmap: BeatmapRequirementConfig,
  play: PlayMetrics,
  tier: RequirementTier,
): RequirementEvaluation {
  const failed: RequirementEvaluation['failed'] = [];

  const requiredScore = tier === 'gold' ? beatmap.goldClearScore : beatmap.requiredScore;
  if (play.score < requiredScore) {
    failed.push('score');
  }

  const minAccuracy = getTierField(tier, beatmap.requiredAccuracy, beatmap.goldRequiredAccuracy);
  if (typeof minAccuracy === 'number' && Number.isFinite(minAccuracy)) {
    if (play.accuracy < minAccuracy) {
      failed.push('accuracy');
    }
  }

  const maxMisses = getTierField(tier, beatmap.maxMisses, beatmap.goldMaxMisses);
  const missesUsed = typeof play.effectiveMisses === 'number' ? play.effectiveMisses : play.countMiss;
  if (typeof maxMisses === 'number' && Number.isFinite(maxMisses)) {
    if (missesUsed > maxMisses) {
      failed.push('misses');
    }
  }

  const minCombo = getTierField(tier, beatmap.minCombo, beatmap.goldMinCombo);
  if (typeof minCombo === 'number' && Number.isFinite(minCombo)) {
    if (play.combo < minCombo) {
      failed.push('combo');
    }
  }

  return { met: failed.length === 0, failed };
}

export function formatRequirementFailures(failed: RequirementEvaluation['failed']): string {
  if (failed.length === 0) return 'Requirements met';
  const labels: Record<RequirementEvaluation['failed'][number], string> = {
    score: 'score',
    accuracy: 'acc',
    misses: 'misses',
    combo: 'combo',
  };
  return `Requirements not met (${failed.map((f) => labels[f]).join(', ')})`;
}
