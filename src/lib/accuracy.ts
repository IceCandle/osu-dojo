import {
  DEFAULT_ACCURACY_VARIANT,
  type AccuracyVariant,
  type LegacyStableScoreStats,
} from "@/lib/domain";

export function describeAccuracyScope(variant: AccuracyVariant): string {
  return `${variant.ruleset}/${variant.client}`;
}

export function calculateAccuracy(
  stats: LegacyStableScoreStats,
  variant: AccuracyVariant = DEFAULT_ACCURACY_VARIANT,
): number | null {
  if (variant.ruleset !== "osu" || variant.client !== "stable") {
    return null;
  }

  const totalHits =
    stats.count300 + stats.count100 + stats.count50 + stats.countMiss;

  if (totalHits === 0) {
    return 0;
  }

  return (
    ((300 * stats.count300 + 100 * stats.count100 + 50 * stats.count50) /
      (300 * totalHits)) *
    100
  );
}

export function requireAccuracy(
  stats: LegacyStableScoreStats,
  variant: AccuracyVariant = DEFAULT_ACCURACY_VARIANT,
): number {
  const accuracy = calculateAccuracy(stats, variant);

  if (accuracy === null) {
    throw new Error(
      `Accuracy calculation is only implemented for ${describeAccuracyScope(
        DEFAULT_ACCURACY_VARIANT,
      )} multiplayer scores right now.`,
    );
  }

  return accuracy;
}
