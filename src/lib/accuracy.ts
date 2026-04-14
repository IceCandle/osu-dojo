import type { StableScoreStats } from "@/lib/domain";

export function calculateAccuracy(
  stats: StableScoreStats,
): number {
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
