import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/bot/status/:attemptId
 * Returns bot connection status for active attempt
 *
 * Used by frontend to show recovery warnings
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { attemptId: string } }
) {
  try {
    const attemptId = parseInt(params.attemptId, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json(
        { error: 'Invalid attempt ID' },
        { status: 400 }
      );
    }

    // Get attempt and associated match ID
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      return NextResponse.json(
        { error: 'Attempt not found' },
        { status: 404 }
      );
    }

    // If no multiplayer ID, bot hasn't started yet
    if (!attempt.multiplayerId) {
      return NextResponse.json({
        connected: false,
        lastHeartbeat: 0,
        recovering: false,
        message: 'Waiting for bot to create lobby...',
      });
    }

    // Check Redis for lobby state
    const lobbyKey = `lobby:${attempt.multiplayerId}`;
    const lobbyData = await redis.hgetall(lobbyKey);

    if (Object.keys(lobbyData).length === 0) {
      // No Redis state - lobby probably completed or abandoned
      return NextResponse.json({
        connected: false,
        lastHeartbeat: 0,
        recovering: false,
        message: 'Lobby not active',
      });
    }

    const lastHeartbeat = parseInt(lobbyData.lastHeartbeat || '0');
    const status = lobbyData.status;

    return NextResponse.json({
      connected: status === 'PLAYING',
      lastHeartbeat,
      recovering: status === 'PAUSED',
      message: status === 'PAUSED' ? 'Bot is recovering, please wait...' : undefined,
    });

  } catch (error) {
    console.error('[BotStatus] API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
