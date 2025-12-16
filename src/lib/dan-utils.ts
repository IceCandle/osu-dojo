import { Beatmap } from '@prisma/client';

/**
 * Calculate the number of maps required for a dan or attempt.
 *
 * Takes into account:
 * - Regular (non-candidate) maps: each counts as 1
 * - Candidate groups: each unique group counts as 1 (one map selected from group)
 * - Banned maps: excluded from calculation
 *
 * @param beatmaps - All beatmaps in the dan
 * @param bannedIds - IDs of beatmaps that have been banned (optional)
 * @returns Total number of maps required to complete
 *
 * @example
 * // Dan with 4 regular maps + 2 candidate groups = 6 maps required
 * const mapsRequired = getMapsRequired(dan.beatmaps);
 *
 * @example
 * // Attempt with 1 banned map
 * const mapsRequired = getMapsRequired(dan.beatmaps, attempt.bannedMapIds);
 */
export function getMapsRequired(
  beatmaps: Beatmap[],
  bannedIds: number[] = []
): number {
  // Filter out banned maps
  const unbanned = beatmaps.filter(b => !bannedIds.includes(b.id));

  // Count regular (non-candidate) maps
  const regularMaps = unbanned.filter(b => !b.isCandidate).length;

  // Count unique candidate groups (each group contributes 1 map)
  const candidateGroups = new Set(
    unbanned
      .filter(b => b.isCandidate && b.candidateGroup !== null)
      .map(b => b.candidateGroup)
  ).size;

  return regularMaps + candidateGroups;
}
