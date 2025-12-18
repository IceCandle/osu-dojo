import { Beatmap } from '@prisma/client';

/**
 * Calculate the number of maps required for a dan or attempt.
 *
 * Static course pivot: all maps are required.
 *
 * @param beatmaps - All beatmaps in the dan
 * @returns Total number of maps required to complete
 *
 * @example
 * // Dan with 6 maps = 6 maps required
 * const mapsRequired = getMapsRequired(dan.beatmaps);
 */
export function getMapsRequired(beatmaps: Beatmap[]): number {
  return beatmaps.length;
}
