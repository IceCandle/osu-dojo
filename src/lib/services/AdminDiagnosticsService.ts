import { prisma } from '../core/prisma';
import { redis } from '../core/redis';
import type { Attempt, AttemptScore } from '@prisma/client';
import { restartAttemptAndRequeue } from './AttemptRestartService';

/**
 * Redis lobby state
 */
interface LobbyState {
  status?: string;
  currentMapIndex: number;
  lastHeartbeat: number;
  mapsCompleted: number;
}

/**
 * Diagnostics result
 */
interface DiagnosticsResult {
  isZombie: boolean;
  isStuck: boolean;
  heartbeatAge: number;
  lastDbUpdate: number;
  recommendedAction: 'OK' | 'RESTART' | 'ABANDON';
}

/**
 * Attempt inspection result
 */
export interface AttemptInspection {
  attempt: {
    id: number;
    userId: number;
    danId: number;
    status: string;
    multiplayerId: string | null;
    totalScore: string;
    averageAccuracy: number;
    isNormalPass: boolean;
    isGoldPass: boolean;
    createdAt: string;
    completedAt: string | null;
  };
  redis: {
    exists: boolean;
    lobbyState: LobbyState | null;
  };
  diagnostics: DiagnosticsResult;
  scores: Array<{
    beatmapId: number;
    score: string;
    accuracy: number;
    passed: boolean;
    metRequirement: boolean;
    playedAt: string;
  }>;
}

/**
 * Service for admin diagnostics and attempt recovery
 * Handles zombie lobby detection, stuck attempt diagnosis, and manual restart
 */
export class AdminDiagnosticsService {
  /**
   * Inspect attempt state for admin oversight
   * @param attemptId Attempt ID to inspect
   * @returns Full inspection report with DB state, Redis state, and diagnostics
   */
  async inspectAttempt(attemptId: number): Promise<AttemptInspection> {
    // Fetch attempt with scores
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        scores: {
          orderBy: { playedAt: 'asc' },
        },
      },
    });

    if (!attempt) {
      throw new Error('Attempt not found');
    }

    // Check Redis state
    const redisState = await this.getRedisState(attempt.multiplayerId);

    // Calculate diagnostics
    const diagnostics = this.computeDiagnostics(attempt, redisState.lobbyState, Date.now());

    return {
      attempt: {
        id: attempt.id,
        userId: attempt.userId,
        danId: attempt.danId,
        status: attempt.status,
        multiplayerId: attempt.multiplayerId,
        totalScore: attempt.totalScore?.toString() || '0',
        averageAccuracy: attempt.averageAccuracy || 0,
        isNormalPass: attempt.isNormalPass,
        isGoldPass: attempt.isGoldPass,
        createdAt: attempt.createdAt.toISOString(),
        completedAt: attempt.completedAt?.toISOString() || null,
      },
      redis: redisState,
      diagnostics,
      scores: attempt.scores.map((s) => ({
        beatmapId: s.beatmapId,
        score: s.score.toString(),
        accuracy: s.accuracy,
        passed: s.passed,
        metRequirement: s.metRequirement,
        playedAt: s.playedAt.toISOString(),
      })),
    };
  }

  /**
   * Manually restart a stuck attempt
   * Cleans up Redis state and re-queues the attempt
   * @param attemptId Attempt ID to restart
   * @returns Success message with attempt ID
   */
  async restartAttempt(attemptId: number): Promise<{
    success: boolean;
    message: string;
    attemptId: number;
  }> {
    await restartAttemptAndRequeue(attemptId);

    return {
      success: true,
      message: 'Attempt restarted (scores cleared) and re-queued',
      attemptId,
    };
  }

  /**
   * Get Redis lobby state
   * @private
   */
  private async getRedisState(multiplayerId: string | null): Promise<{
    exists: boolean;
    lobbyState: LobbyState | null;
  }> {
    if (!multiplayerId) {
      return { exists: false, lobbyState: null };
    }

    const lobbyKey = `lobby:${multiplayerId}`;
    const lobbyState = await redis.hgetall(lobbyKey);

    const lobbyExists = Object.keys(lobbyState).length > 0;

    if (!lobbyExists) {
      return { exists: false, lobbyState: null };
    }

    return {
      exists: true,
      lobbyState: {
        status: lobbyState.status,
        currentMapIndex: parseInt(lobbyState.currentMapIndex || '0'),
        lastHeartbeat: parseInt(lobbyState.lastHeartbeat || '0'),
        mapsCompleted: parseInt(lobbyState.mapsCompleted || '0'),
      },
    };
  }

  /**
   * Compute diagnostics for attempt health
   * @private
   */
  private computeDiagnostics(
    attempt: Attempt & { scores: AttemptScore[] },
    lobbyState: LobbyState | null,
    now: number,
  ): DiagnosticsResult {
    const lastHeartbeat = lobbyState?.lastHeartbeat || 0;
    const heartbeatAge = Math.floor((now - lastHeartbeat) / 1000);

    const lastScore = attempt.scores[attempt.scores.length - 1];
    const lastDbUpdate = lastScore
      ? Math.floor((now - new Date(lastScore.playedAt).getTime()) / 1000)
      : 0;

    const isZombie = heartbeatAge > 300; // 5 minutes
    const isStuck = lastDbUpdate > 600; // 10 minutes

    let recommendedAction: 'OK' | 'RESTART' | 'ABANDON' = 'OK';
    if (isZombie || isStuck) {
      recommendedAction = attempt.status === 'IN_PROGRESS' ? 'RESTART' : 'ABANDON';
    }

    return {
      isZombie,
      isStuck,
      heartbeatAge,
      lastDbUpdate,
      recommendedAction,
    };
  }
}

// Singleton export
export const adminDiagnosticsService = new AdminDiagnosticsService();
