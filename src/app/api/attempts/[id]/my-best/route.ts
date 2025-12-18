import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseReplayToTimeSeries } from '@/lib/replay-parser';
import { getStorage } from '@/lib/storage';

/**
 * GET /api/attempts/[id]/my-best
 * Returns time-series score data for user's previous best attempt on same dan
 *
 * Response format:
 * {
 *   beatmapId: number,      // osu! beatmap ID for validation
 *   duration: number,        // Map length in ms
 *   timeSeries: Array<{ time, score, combo, accuracy }>,
 *   finalScore: number       // Final score for hollow bar display
 * }
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const attemptId = parseInt(id, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }

    // Fetch current attempt with dan and beatmaps
    const currentAttempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        dan: {
          include: {
            beatmaps: {
              orderBy: {
                orderIndex: 'asc',
              },
            },
          },
        },
      },
    });

    if (!currentAttempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // Get the current map being played
    const currentBeatmap = currentAttempt.dan.beatmaps[currentAttempt.currentMapIndex];

    if (!currentBeatmap) {
      return NextResponse.json({ error: 'Current beatmap not found' }, { status: 404 });
    }

    // Query for user's previous best attempts on this dan
    const previousAttempts = await prisma.attempt.findMany({
      where: {
        userId: currentAttempt.userId,
        danId: currentAttempt.danId,
        status: 'COMPLETED',
        id: { not: attemptId }, // Exclude current attempt
      },
      include: {
        scores: {
          where: {
            beatmapId: currentBeatmap.id, // DB primary key
          },
          include: {
            beatmap: true,
          },
        },
        replays: {
          where: {
            beatmapId: currentBeatmap.id, // Filter to current map's replay
          },
        },
      },
      orderBy: {
        totalScore: 'desc',
      },
      take: 1,
    });

    // No previous attempts found
    if (previousAttempts.length === 0 || !previousAttempts[0].scores[0]) {
      return NextResponse.json(
        { error: 'No previous attempts found for this beatmap' },
        { status: 404 },
      );
    }

    const bestAttempt = previousAttempts[0];
    const bestScore = bestAttempt.scores[0];

    // Parse replay file - required for pacemaker
    const replayKey = bestAttempt.replays[0]?.filePath;
    const storage = getStorage();

    if (!replayKey || !(await storage.exists(replayKey))) {
      return NextResponse.json(
        { error: 'Replay file not found for best attempt' },
        { status: 404 },
      );
    }

    let timeSeries;
    try {
      // Parse actual replay file for accurate time-series data
      console.log(`[MyBest] Parsing replay key: ${replayKey}`);
      timeSeries = await parseReplayToTimeSeries(replayKey, currentBeatmap.beatmapId);
    } catch (error) {
      console.error('[MyBest] Replay parsing failed:', error);
      return NextResponse.json(
        {
          error: 'Failed to parse replay file',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }

    // Return formatted response
    return NextResponse.json({
      beatmapId: currentBeatmap.beatmapId, // For tosu validation
      duration: (currentBeatmap.length || 180) * 1000,
      finalScore: Number(bestScore.score),
      timeSeries: timeSeries.map(({ time, score, combo, accuracy }) => ({
        time,
        score,
        combo,
        accuracy,
      })),
      metadata: {
        attemptId: bestAttempt.id,
        totalScore: Number(bestAttempt.totalScore),
        averageAccuracy: bestAttempt.averageAccuracy,
        completedAt: bestAttempt.updatedAt,
      },
    });
  } catch (error) {
    console.error('[MyBest] API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
