/**
 * Match Generator Service
 * Extracts ban phase and map selection logic from god functions
 *
 * Responsibilities:
 * 1. Organize beatmaps into candidates and non-candidates
 * 2. Execute ban phase via IRC DM
 * 3. Random selection from remaining candidate groups
 * 4. Sort final map list
 */

import type BanchoJs from 'bancho.js';
import { redis } from '@/lib/redis';
import { createLogger } from '@/lib/logger';
import { BOT_TIMEOUTS, BOT_LIMITS } from '@/bot/constants';
import { BAN_PHASE_MESSAGES } from '@/bot/messages';

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
  skillFocus: string | null;
  gameMode: string;
  isCandidate: boolean;
  candidateGroup: number | null;
  orderIndex: number;
}

/**
 * Result of ban phase execution
 */
export interface BanResult {
  bannedMapIds: number[]; // Beatmap.id values
  bannedIndices: number[]; // 1-based indices for display
}

/**
 * Organized beatmap groups
 */
export interface OrganizedBeatmaps {
  nonCandidates: BeatmapData[];
  candidateGroups: Map<number, BeatmapData[]>;
}

/**
 * Match Generator Service
 * Handles ban phase and candidate selection logic
 */
export class MatchGenerator {
  /**
   * Organize beatmaps into non-candidates and candidate groups
   */
  organizeBeatmaps(beatmaps: BeatmapData[]): OrganizedBeatmaps {
    const nonCandidates = beatmaps.filter((m) => !m.isCandidate);
    const candidateGroups = new Map<number, BeatmapData[]>();

    beatmaps.forEach((map) => {
      if (map.isCandidate && map.candidateGroup !== null) {
        if (!candidateGroups.has(map.candidateGroup)) {
          candidateGroups.set(map.candidateGroup, []);
        }
        candidateGroups.get(map.candidateGroup)!.push(map);
      }
    });

    logger.info('Beatmaps organized', {
      nonCandidates: nonCandidates.length,
      candidateGroups: candidateGroups.size,
    });

    return { nonCandidates, candidateGroups };
  }

  /**
   * Execute ban phase via IRC DM
   * Returns banned map IDs and indices
   */
  async conductBanPhase(
    bot: BanchoJs.BanchoClient,
    attemptId: number,
    osuId: number,
    username: string,
    candidateGroups: Map<number, BeatmapData[]>,
    maxBans: number,
  ): Promise<BanResult> {
    // If no bans allowed or no candidates, skip
    if (maxBans === 0 || candidateGroups.size === 0) {
      logger.info('Ban phase skipped', { maxBans, candidateGroups: candidateGroups.size });
      return { bannedMapIds: [], bannedIndices: [] };
    }

    // Flatten and index candidates for display
    const flatCandidates: Array<{
      index: number;
      candidateGroup: number;
      beatmapId: number;
      title: string;
      dbId: number;
    }> = [];

    let index = 1;
    candidateGroups.forEach((maps, group) => {
      maps.forEach((map) => {
        flatCandidates.push({
          index: index++,
          candidateGroup: group,
          beatmapId: map.beatmapId,
          title: map.beatmapTitle || `Beatmap ${map.beatmapId}`,
          dbId: map.id,
        });
      });
    });

    // Sort by candidateGroup, then beatmapId
    flatCandidates.sort((a, b) => {
      if (a.candidateGroup !== b.candidateGroup) {
        return a.candidateGroup - b.candidateGroup;
      }
      return a.beatmapId - b.beatmapId;
    });

    // Re-index after sorting
    flatCandidates.forEach((c, i) => {
      c.index = i + 1;
    });

    // Create ban session in Redis
    const banSessionKey = `ban-session:${attemptId}`;
    const banSelectionKey = `ban-selection:${attemptId}`;

    await redis.set(
      banSessionKey,
      JSON.stringify({
        attemptId,
        osuId,
        username,
        candidates: flatCandidates,
        maxBans,
        createdAt: Date.now(),
      }),
      'EX',
      BOT_LIMITS.BAN_SESSION_TTL_SECONDS,
    );

    logger.info('Ban session created', { attemptId, candidateCount: flatCandidates.length });

    // Send DM to player
    try {
      const user = await bot.getUser(username);

      // Build header message
      const headerLines = BAN_PHASE_MESSAGES.header(attemptId, maxBans);

      // Build candidate lines
      const candidateLines = flatCandidates.map((c) => BAN_PHASE_MESSAGES.candidateLine(c));

      // Combine all lines
      const allLines = [...headerLines, ...candidateLines];

      // Send in chunks (12 lines per message)
      for (let i = 0; i < allLines.length; i += BOT_LIMITS.DM_CHUNK_SIZE) {
        const chunk = allLines.slice(i, i + BOT_LIMITS.DM_CHUNK_SIZE);
        await user.sendMessage(chunk.join('\n'));
      }

      logger.info('Ban phase DM sent', { username, lines: allLines.length });
    } catch (error) {
      logger.error('Failed to send ban phase DM', { username, error });
      // Continue without bans
      return { bannedMapIds: [], bannedIndices: [] };
    }

    // Poll for ban selection (30s timeout, 500ms interval)
    const startTime = Date.now();
    let bannedIndices: number[] = [];

    while (Date.now() - startTime < BOT_TIMEOUTS.BAN_PHASE_MS) {
      const selection = await redis.get(banSelectionKey);
      if (selection) {
        bannedIndices = JSON.parse(selection);
        logger.info('Ban selection received', { bannedIndices });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, BOT_TIMEOUTS.BAN_POLL_INTERVAL_MS));
    }

    // Map indices to Beatmap.id values
    const bannedMapIds = bannedIndices
      .map((idx) => flatCandidates.find((c) => c.index === idx)?.dbId)
      .filter((id): id is number => id !== undefined);

    // Clean up Redis keys
    await redis.del(banSessionKey, banSelectionKey);

    logger.info('Ban phase complete', {
      attemptId,
      bannedCount: bannedMapIds.length,
      bannedIndices,
    });

    return { bannedMapIds, bannedIndices };
  }

  /**
   * Remove banned maps from candidate groups
   */
  applyBans(
    candidateGroups: Map<number, BeatmapData[]>,
    bannedMapIds: number[],
  ): Map<number, BeatmapData[]> {
    const filtered = new Map<number, BeatmapData[]>();

    candidateGroups.forEach((maps, group) => {
      const remaining = maps.filter((m) => !bannedMapIds.includes(m.id));
      if (remaining.length > 0) {
        filtered.set(group, remaining);
      }
    });

    return filtered;
  }

  /**
   * Random selection from remaining candidates in each group
   */
  selectCandidates(candidateGroups: Map<number, BeatmapData[]>): BeatmapData[] {
    const selected: BeatmapData[] = [];

    candidateGroups.forEach((maps, group) => {
      if (maps.length > 0) {
        const randomMap = maps[Math.floor(Math.random() * maps.length)];
        selected.push(randomMap);

        logger.info('Selected candidate map', {
          group,
          beatmapId: randomMap.beatmapId,
          title: randomMap.beatmapTitle,
        });
      }
    });

    return selected;
  }

  /**
   * Build final map list with proper sorting
   * Non-candidates sorted by orderIndex, then candidates by candidateGroup
   */
  buildFinalMapList(
    nonCandidates: BeatmapData[],
    selectedCandidates: BeatmapData[],
  ): BeatmapData[] {
    const finalList = [...nonCandidates, ...selectedCandidates];

    finalList.sort((a, b) => {
      // Non-candidates keep their orderIndex
      if (!a.isCandidate && !b.isCandidate) return a.orderIndex - b.orderIndex;
      if (!a.isCandidate) return -1;
      if (!b.isCandidate) return 1;

      // Candidates sorted by candidateGroup
      return (a.candidateGroup || 0) - (b.candidateGroup || 0);
    });

    logger.info('Final map list built', { mapCount: finalList.length });

    return finalList;
  }

  /**
   * High-level orchestration method
   * Executes full ban phase + selection flow
   */
  async generateMatchMaps(
    bot: BanchoJs.BanchoClient,
    attemptId: number,
    osuId: number,
    username: string,
    beatmaps: BeatmapData[],
    allowedBans: number,
  ): Promise<{
    finalMaps: BeatmapData[];
    banResult: BanResult;
  }> {
    // Step 1: Organize beatmaps
    const { nonCandidates, candidateGroups } = this.organizeBeatmaps(beatmaps);

    // Step 2: Ban phase
    const banResult = await this.conductBanPhase(
      bot,
      attemptId,
      osuId,
      username,
      candidateGroups,
      allowedBans,
    );

    // Step 3: Apply bans
    const filteredGroups = this.applyBans(candidateGroups, banResult.bannedMapIds);

    // Step 4: Random selection
    const selectedCandidates = this.selectCandidates(filteredGroups);

    // Step 5: Build final list
    const finalMaps = this.buildFinalMapList(nonCandidates, selectedCandidates);

    return { finalMaps, banResult };
  }
}
