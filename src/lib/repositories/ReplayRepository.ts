import { prisma } from '../core/prisma';
import { getStorage } from '../core/storage';
import type { Replay, Prisma } from '@prisma/client';

/**
 * Replay metadata for storage
 * Note: Detailed stats (accuracy, combo, hit counts) are stored in AttemptScore, not Replay
 */
export interface ReplayMetadata {
  score: bigint;
  replayTimestamp?: Date;
  fileName: string;
  fileSize?: number;
}

/**
 * Repository for replay database and file storage operations
 * Handles both database records and S3/local file storage
 */
export class ReplayRepository {
  /**
   * Save replay file and create database record
   * @param userId User ID
   * @param attemptId Attempt ID
   * @param beatmapId Beatmap ID (DB primary key)
   * @param danId Dan ID
   * @param file Replay file buffer
   * @param metadata Replay metadata
   * @returns Created replay record
   */
  async save(
    userId: number,
    attemptId: number,
    beatmapId: number,
    danId: number,
    file: Buffer,
    metadata: ReplayMetadata,
  ): Promise<Replay> {
    const storage = getStorage();

    // Generate storage key
    const timestamp = Date.now();
    const filePath = `replays/${userId}/${attemptId}/${beatmapId}-${timestamp}.osr`;

    // Upload to storage
    await storage.write(filePath, file);

    // Create database record
    return prisma.replay.create({
      data: {
        userId,
        attemptId,
        beatmapId,
        danId,
        fileName: metadata.fileName,
        filePath,
        fileSize: metadata.fileSize,
        score: metadata.score,
        replayTimestamp: metadata.replayTimestamp,
      },
    });
  }

  /**
   * Find replay by attempt and beatmap
   * @param attemptId Attempt ID
   * @param beatmapId Beatmap ID (DB primary key)
   * @returns Replay or null if not found
   */
  async findByAttemptAndBeatmap(attemptId: number, beatmapId: number): Promise<Replay | null> {
    return prisma.replay.findFirst({
      where: {
        attemptId,
        beatmapId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Find user's best replay for a dan (highest score)
   * @param danId Dan ID
   * @param userId User ID
   * @returns Best replay or null if none exists
   */
  async findBestForDanAndUser(danId: number, userId: number): Promise<Replay | null> {
    const bestAttempt = await prisma.attempt.findFirst({
      where: {
        danId,
        userId,
        status: 'COMPLETED',
      },
      orderBy: {
        totalScore: 'desc',
      },
      include: {
        replays: {
          orderBy: {
            score: 'desc',
          },
          take: 1,
        },
      },
    });

    return bestAttempt?.replays[0] || null;
  }

  /**
   * Read replay file from storage
   * @param replayKey Storage key for replay file
   * @returns Replay file buffer
   * @throws Error if file not found
   */
  async readReplayFile(replayKey: string): Promise<Buffer> {
    const storage = getStorage();

    const exists = await storage.exists(replayKey);
    if (!exists) {
      throw new Error(`Replay file not found: ${replayKey}`);
    }

    return storage.read(replayKey);
  }

  /**
   * Find replays for an attempt
   * @param attemptId Attempt ID
   * @param include Optional relations to include
   * @returns List of replays for the attempt
   */
  async findByAttempt(attemptId: number, include?: Prisma.ReplayInclude): Promise<Replay[]> {
    return prisma.replay.findMany({
      where: {
        attemptId,
      },
      include,
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Find replays for a user
   * @param userId User ID
   * @param limit Maximum number of replays to return
   * @returns List of replays for the user
   */
  async findByUser(userId: number, limit?: number): Promise<Replay[]> {
    return prisma.replay.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });
  }

  /**
   * Delete replay file and database record
   * @param replayId Replay ID
   * @returns Deleted replay record
   */
  async delete(replayId: number): Promise<Replay> {
    const replay = await prisma.replay.findUnique({
      where: { id: replayId },
    });

    if (!replay) {
      throw new Error(`Replay not found: ${replayId}`);
    }

    const storage = getStorage();

    // Delete file from storage (if filePath exists)
    if (replay.filePath) {
      try {
        await storage.delete(replay.filePath);
      } catch (error) {
        console.warn(`Failed to delete replay file: ${replay.filePath}`, error);
        // Continue with database deletion even if file deletion fails
      }
    }

    // Delete database record
    return prisma.replay.delete({
      where: { id: replayId },
    });
  }
}

// Singleton export
export const replayRepository = new ReplayRepository();
