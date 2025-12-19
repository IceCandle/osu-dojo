import { prisma } from '../core/prisma';
import type { Attempt, AttemptStatus, Prisma } from '@prisma/client';

/**
 * Data for updating attempt progress
 */
export interface UpdateProgressData {
  currentMapIndex?: number;
  mapsCompleted?: number;
  multiplayerId?: string | null;
  status?: AttemptStatus;
}

/**
 * Data for marking attempt as completed
 */
export interface CompletionResult {
  totalScore: bigint;
  averageAccuracy: number;
  isNormalPass: boolean;
  isGoldPass: boolean;
  completedAt: Date;
}

/**
 * Repository for attempt database operations
 * Abstracts Prisma queries for testability and consistency
 */
export class AttemptRepository {
  /**
   * Find attempt by ID with optional relations
   * @param attemptId Attempt ID
   * @param include Optional relations to include
   * @returns Attempt or null if not found
   */
  async findById(attemptId: number, include?: Prisma.AttemptInclude): Promise<Attempt | null> {
    return prisma.attempt.findUnique({
      where: { id: attemptId },
      include,
    });
  }

  /**
   * Find active attempt for a user
   * @param userId User ID
   * @returns Active attempt or null if none exists
   */
  async findActiveByUser(userId: number): Promise<Attempt | null> {
    return prisma.attempt.findFirst({
      where: {
        userId,
        status: 'IN_PROGRESS',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Find completed attempts for a dan
   * @param danId Dan ID
   * @param limit Maximum number of attempts to return
   * @returns List of completed attempts, ordered by total score descending
   */
  async findCompletedByDan(danId: number, limit?: number): Promise<Attempt[]> {
    return prisma.attempt.findMany({
      where: {
        danId,
        status: 'COMPLETED',
      },
      orderBy: {
        totalScore: 'desc',
      },
      take: limit,
    });
  }

  /**
   * Update attempt progress
   * @param attemptId Attempt ID
   * @param data Progress data to update
   * @returns Updated attempt
   */
  async updateProgress(attemptId: number, data: UpdateProgressData): Promise<Attempt> {
    return prisma.attempt.update({
      where: { id: attemptId },
      data,
    });
  }

  /**
   * Create new attempt
   * @param data Attempt creation data
   * @returns Created attempt
   */
  async create(data: Prisma.AttemptCreateInput): Promise<Attempt> {
    return prisma.attempt.create({
      data,
    });
  }

  /**
   * Mark attempt as completed with final results
   * @param attemptId Attempt ID
   * @param result Completion result data
   * @returns Updated attempt
   */
  async markCompleted(attemptId: number, result: CompletionResult): Promise<Attempt> {
    return prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: 'COMPLETED',
        totalScore: result.totalScore,
        averageAccuracy: result.averageAccuracy,
        isNormalPass: result.isNormalPass,
        isGoldPass: result.isGoldPass,
        completedAt: result.completedAt,
      },
    });
  }

  /**
   * Mark attempt as failed
   * @param attemptId Attempt ID
   * @returns Updated attempt
   */
  async markFailed(attemptId: number): Promise<Attempt> {
    return prisma.attempt.update({
      where: { id: attemptId },
      data: {
        // Prisma schema models "failed" as a completed attempt where pass flags remain false.
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }

  /**
   * Mark attempt as abandoned
   * @param attemptId Attempt ID
   * @returns Updated attempt
   */
  async markAbandoned(attemptId: number): Promise<Attempt> {
    return prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: 'ABANDONED',
        completedAt: new Date(),
      },
    });
  }

  /**
   * Find attempts for a user on a specific dan
   * @param userId User ID
   * @param danId Dan ID
   * @param status Optional status filter
   * @returns List of attempts
   */
  async findByUserAndDan(
    userId: number,
    danId: number,
    status?: AttemptStatus,
  ): Promise<Attempt[]> {
    return prisma.attempt.findMany({
      where: {
        userId,
        danId,
        ...(status && { status }),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

// Singleton export
export const attemptRepository = new AttemptRepository();
