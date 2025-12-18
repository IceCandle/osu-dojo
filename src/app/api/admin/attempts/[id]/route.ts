import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/core/redis';
import { prisma } from '@/lib/core/prisma';
import { requireAdminSession } from '@/lib/auth/admin-auth';

/**
 * GET /api/admin/attempts/:id
 * Inspect attempt state for admin oversight
 * Returns DB record + Redis state + diagnostics
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdminSession();
    if (!adminCheck.ok) return adminCheck.res;

    const { id } = await params;
    const attemptId = parseInt(id, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }

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
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // Check Redis state
    let redisData = null;
    let lobbyExists = false;

    if (attempt.multiplayerId) {
      const lobbyKey = `lobby:${attempt.multiplayerId}`;
      const lobbyState = await redis.hgetall(lobbyKey);

      lobbyExists = Object.keys(lobbyState).length > 0;

      if (lobbyExists) {
        redisData = {
          status: lobbyState.status,
          currentMapIndex: parseInt(lobbyState.currentMapIndex || '0'),
          lastHeartbeat: parseInt(lobbyState.lastHeartbeat || '0'),
          mapsCompleted: parseInt(lobbyState.mapsCompleted || '0'),
        };
      }
    }

    // Calculate diagnostics
    const now = Date.now();
    const lastHeartbeat = redisData?.lastHeartbeat || 0;
    const heartbeatAge = Math.floor((now - lastHeartbeat) / 1000);

    const lastScore = attempt.scores[attempt.scores.length - 1];
    const lastDbUpdate = lastScore
      ? Math.floor((now - new Date(lastScore.playedAt).getTime()) / 1000)
      : 0;

    const isZombie = heartbeatAge > 300; // 5 minutes
    const isStuck = lastDbUpdate > 600; // 10 minutes

    let recommendedAction = 'OK';
    if (isZombie || isStuck) {
      recommendedAction = attempt.status === 'IN_PROGRESS' ? 'RESTART' : 'ABANDON';
    }

    return NextResponse.json({
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
      redis: {
        exists: lobbyExists,
        lobbyState: redisData,
      },
      diagnostics: {
        isZombie,
        isStuck,
        heartbeatAge,
        lastDbUpdate,
        recommendedAction,
      },
      scores: attempt.scores.map((s) => ({
        beatmapId: s.beatmapId,
        score: s.score.toString(),
        accuracy: s.accuracy,
        passed: s.passed,
        metRequirement: s.metRequirement,
        playedAt: s.playedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[AdminAPI] Inspection error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/attempts/:id/restart
 * Manually restart a stuck attempt
 * Cleans up Redis state and re-queues the attempt
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdminSession();
    if (!adminCheck.ok) return adminCheck.res;

    const { id } = await params;
    const attemptId = parseInt(id, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }

    // Verify attempt exists
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // Clean up old Redis state
    if (attempt.multiplayerId) {
      const { deleteLobbyState } = await import('@/bot/recovery');
      await deleteLobbyState(attempt.multiplayerId);
    }

    // Reset attempt status
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: 'IN_PROGRESS',
        multiplayerId: null,
      },
    });

    // Re-enqueue
    const { enqueueAttempt } = await import('@/lib/core/redis');
    await enqueueAttempt(attemptId);

    return NextResponse.json({
      success: true,
      message: 'Attempt restarted and re-queued',
      attemptId,
    });
  } catch (error) {
    console.error('[AdminAPI] Restart error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
