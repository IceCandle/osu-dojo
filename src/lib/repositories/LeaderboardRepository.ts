import { prisma } from '../core/prisma';
import { redis } from '../core/redis';
import type { Attempt, User } from '@prisma/client';

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  avatarUrl: string | null;
  totalScore: bigint;
  averageAccuracy: number;
  isNormalPass: boolean;
  isGoldPass: boolean;
  completedAt: Date;
  attemptId: number;
}

/**
 * Repository for leaderboard queries with Redis caching
 * Handles leaderboard generation and rank lookups
 */
export class LeaderboardRepository {
  private readonly CACHE_TTL = 300; // 5 minutes

  /**
   * Get top scores for a dan with Redis caching
   * @param danId Dan ID
   * @param limit Maximum number of entries to return
   * @returns List of leaderboard entries
   */
  async getTopScoresForDan(danId: number, limit: number = 100): Promise<LeaderboardEntry[]> {
    const cacheKey = `leaderboard:dan:${danId}:limit:${limit}`;

    // Try cache first
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached, (_key, value) => {
          // Revive BigInt and Date objects
          if (_key === 'totalScore') return BigInt(value);
          if (_key === 'completedAt') return new Date(value);
          return value;
        });
      }
    } catch (error) {
      console.warn('[LeaderboardRepository] Cache read failed:', error);
      // Continue with database query if cache fails
    }

    // Fetch from database
    const attempts = await prisma.attempt.findMany({
      where: {
        danId,
        status: 'COMPLETED',
      },
      include: {
        user: true,
      },
      orderBy: [
        { totalScore: 'desc' },
        { completedAt: 'asc' }, // Earlier completion wins ties
      ],
      take: limit,
    });

    // Transform to leaderboard entries
    const entries: LeaderboardEntry[] = attempts.map((attempt, index) => ({
      rank: index + 1,
      userId: attempt.userId,
      username: attempt.user.osuUsername,
      avatarUrl: attempt.user.avatarUrl,
      totalScore: attempt.totalScore || BigInt(0),
      averageAccuracy: attempt.averageAccuracy || 0,
      isNormalPass: attempt.isNormalPass,
      isGoldPass: attempt.isGoldPass,
      completedAt: attempt.completedAt || attempt.updatedAt,
      attemptId: attempt.id,
    }));

    // Cache the result
    try {
      await redis.setex(
        cacheKey,
        this.CACHE_TTL,
        JSON.stringify(entries, (_key, value) =>
          // Stringify BigInt as string
          typeof value === 'bigint' ? value.toString() : value,
        ),
      );
    } catch (error) {
      console.warn('[LeaderboardRepository] Cache write failed:', error);
      // Continue even if cache write fails
    }

    return entries;
  }

  /**
   * Get user's rank for a specific dan
   * @param danId Dan ID
   * @param userId User ID
   * @returns User's rank (1-indexed) or null if user hasn't completed the dan
   */
  async getUserRankForDan(danId: number, userId: number): Promise<number | null> {
    // Get user's best attempt for this dan
    const userAttempt = await prisma.attempt.findFirst({
      where: {
        danId,
        userId,
        status: 'COMPLETED',
      },
      orderBy: [{ totalScore: 'desc' }, { completedAt: 'asc' }],
    });

    if (!userAttempt || !userAttempt.completedAt) {
      return null;
    }

    // Count how many attempts have a higher score or same score but earlier completion
    const rank = await prisma.attempt.count({
      where: {
        danId,
        status: 'COMPLETED',
        OR: [
          { totalScore: { gt: userAttempt.totalScore } },
          {
            totalScore: userAttempt.totalScore,
            completedAt: { lt: userAttempt.completedAt },
          },
        ],
      },
    });

    return rank + 1; // Convert to 1-indexed rank
  }

  /**
   * Invalidate leaderboard cache for a dan
   * Call this when a new score is submitted
   * @param danId Dan ID
   */
  async invalidateCache(danId: number): Promise<void> {
    try {
      const pattern = `leaderboard:dan:${danId}:*`;
      const keys = await redis.keys(pattern);

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.warn('[LeaderboardRepository] Cache invalidation failed:', error);
      // Don't throw - cache invalidation failure is not critical
    }
  }

  /**
   * Get user's personal best for a dan
   * @param danId Dan ID
   * @param userId User ID
   * @returns Best attempt or null if user hasn't completed the dan
   */
  async getUserBestForDan(
    danId: number,
    userId: number,
  ): Promise<(Attempt & { user: User }) | null> {
    return prisma.attempt.findFirst({
      where: {
        danId,
        userId,
        status: 'COMPLETED',
      },
      include: {
        user: true,
      },
      orderBy: [{ totalScore: 'desc' }, { completedAt: 'asc' }],
    });
  }

  /**
   * Get recent completions for a dan
   * @param danId Dan ID
   * @param limit Maximum number of entries to return
   * @returns List of recent completions
   */
  async getRecentCompletions(danId: number, limit: number = 10): Promise<LeaderboardEntry[]> {
    const attempts = await prisma.attempt.findMany({
      where: {
        danId,
        status: 'COMPLETED',
      },
      include: {
        user: true,
      },
      orderBy: {
        completedAt: 'desc',
      },
      take: limit,
    });

    return attempts.map((attempt, index) => ({
      rank: index + 1,
      userId: attempt.userId,
      username: attempt.user.osuUsername,
      avatarUrl: attempt.user.avatarUrl,
      totalScore: attempt.totalScore || BigInt(0),
      averageAccuracy: attempt.averageAccuracy || 0,
      isNormalPass: attempt.isNormalPass,
      isGoldPass: attempt.isGoldPass,
      completedAt: attempt.completedAt || attempt.updatedAt,
      attemptId: attempt.id,
    }));
  }
}

// Singleton export
export const leaderboardRepository = new LeaderboardRepository();
