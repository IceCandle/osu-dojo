/**
 * Match Generator Service
 *
 * Static course pivot:
 * - No ban phase
 * - No candidate groups
 * - Randomize order per attempt (shuffle)
 * - Optional boss convention: if the last map is marked as boss, keep it fixed and
 *   shuffle only the first n-1 maps.
 */

import type BanchoJs from 'bancho.js';
import { createLogger } from '@/lib/core/logger';

const logger = createLogger('MatchGenerator');

/**
 * Beatmap data structure (matches Prisma Beatmap model subset)
 */
export interface BeatmapData {
  id: number; // DB primary key
  beatmapId: number; // osu! beatmap ID
  beatmapTitle: string | null;
  mods: string[];
  requiredScore: bigint;
  goldClearScore: bigint;
  requiredAccuracy?: number | null;
  maxMisses?: number | null;
  minCombo?: number | null;
  goldRequiredAccuracy?: number | null;
  goldMaxMisses?: number | null;
  goldMinCombo?: number | null;
  skillFocus: string | null;
  gameMode: string;
  orderIndex: number;
}

function isBossByConvention(map: BeatmapData | undefined): boolean {
  if (!map) return false;
  const focus = map.skillFocus?.toLowerCase() ?? '';
  if (focus.includes('boss')) return true;
  const title = map.beatmapTitle?.toLowerCase() ?? '';
  return title.includes('[boss]') || title.includes('(boss)');
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Match Generator Service
 * Static course selection (shuffle + optional boss-last convention)
 */
export class MatchGenerator {
  /**
   * High-level orchestration method
   * Static course selection + shuffle
   */
  async generateMatchMaps(
    bot: BanchoJs.BanchoClient,
    attemptId: number,
    osuId: number,
    username: string,
    beatmaps: BeatmapData[],
  ): Promise<{ finalMaps: BeatmapData[] }> {
    void bot;
    void attemptId;
    void osuId;
    void username;

    // Ensure a stable base ordering before shuffling.
    const ordered = [...beatmaps].sort((a, b) => a.orderIndex - b.orderIndex);

    const last = ordered[ordered.length - 1];
    const hasBoss = isBossByConvention(last);

    if (hasBoss && ordered.length > 1) {
      const head = ordered.slice(0, -1);
      shuffleInPlace(head);
      const finalMaps = [...head, last];
      logger.info('Static course maps generated (boss-last)', { mapCount: finalMaps.length });
      return { finalMaps };
    }

    shuffleInPlace(ordered);
    logger.info('Static course maps generated (full-shuffle)', { mapCount: ordered.length });
    return { finalMaps: ordered };
  }
}
