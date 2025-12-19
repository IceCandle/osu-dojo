import 'server-only';

import { prisma } from '@/lib/core/prisma';
import { enqueueAttempt, redis } from '@/lib/core/redis';

/**
 * Reset an attempt so it can be replayed from scratch.
 *
 * Important:
 * - Attempts have a unique constraint on (attemptId, beatmapId) in AttemptScore.
 *   If we re-run an attempt without clearing scores, the bot will fail to persist new map results.
 */
export async function resetAttemptForRetry(attemptId: number): Promise<void> {
  await prisma.$transaction([
    prisma.attemptScore.deleteMany({ where: { attemptId } }),
    prisma.replay.deleteMany({ where: { attemptId } }),
    prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: 'IN_PROGRESS',
        multiplayerId: null,
        multiplayerUrl: null,
        currentMapIndex: 0,
        mapsCompleted: 0,
        totalScore: BigInt(0),
        averageAccuracy: null,
        failedMapId: null,
        isNormalPass: false,
        isGoldPass: false,
        completedAt: null,
      },
    }),
  ]);
}

/**
 * Best-effort: delete lobby state from Redis.
 * (We keep this in lib/ rather than importing bot/recovery.ts to avoid bot-only dependencies.)
 */
export async function deleteLobbyStateByMatchId(matchId: string): Promise<void> {
  await redis.del(`lobby:${matchId}`);
}

/**
 * Restart an attempt by clearing derived state and re-adding it to the bot queue.
 */
export async function restartAttemptAndRequeue(attemptId: number): Promise<void> {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt) {
    throw new Error(`Attempt ${attemptId} not found`);
  }

  if (attempt.multiplayerId) {
    await deleteLobbyStateByMatchId(attempt.multiplayerId);
  }

  await resetAttemptForRetry(attemptId);
  await enqueueAttempt(attemptId);
}
