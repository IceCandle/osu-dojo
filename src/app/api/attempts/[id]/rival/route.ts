import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseReplayToTimeSeries } from '@/lib/replay-parser';
import { existsSync } from 'fs';

type RivalMode = 'clear' | 'gold-clear' | 'national' | 'friends' | 'same-rank' | 'rotate';

/**
 * GET /api/attempts/[id]/rival?mode=gold-clear
 * Returns time-series score data for rival comparison based on mode
 *
 * Query params:
 * - mode: clear | gold-clear | national | friends | same-rank | rotate
 *
 * Response format:
 * {
 *   beatmapId: number,
 *   duration: number,
 *   finalScore: number,
 *   timeSeries: Array<{ time, score, combo, accuracy }>,
 *   rivalName: string
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const attemptId = parseInt(params.id, 10);
    const searchParams = request.nextUrl.searchParams;
    const mode = (searchParams.get('mode') || 'clear') as RivalMode;

    if (isNaN(attemptId)) {
      return NextResponse.json(
        { error: 'Invalid attempt ID' },
        { status: 400 }
      );
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
            goldClearReplay: {
              include: {
                attempt: {
                  include: {
                    scores: {
                      include: {
                        beatmap: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!currentAttempt) {
      return NextResponse.json(
        { error: 'Attempt not found' },
        { status: 404 }
      );
    }

    // Get the current map being played
    const currentBeatmap = currentAttempt.dan.beatmaps[currentAttempt.currentMapIndex];

    if (!currentBeatmap) {
      return NextResponse.json(
        { error: 'Current beatmap not found' },
        { status: 404 }
      );
    }

    const duration = (currentBeatmap.length || 180) * 1000;

    // Handle different rival modes
    switch (mode) {
      case 'clear': {
        // Clear mode: no replay available, just return threshold
        const clearScore = Number(currentBeatmap.requiredScore);

        return NextResponse.json({
          beatmapId: currentBeatmap.beatmapId,
          duration,
          finalScore: clearScore,
          timeSeries: [],  // No time-series for threshold-only mode
          rivalName: 'Clear Threshold',
          isThresholdOnly: true,  // Flag to indicate this is just a score line, not a replay
        });
      }

      case 'gold-clear': {
        // Return dan gold clear replay
        if (!currentAttempt.dan.goldClearReplay) {
          return NextResponse.json(
            { error: 'No gold clear replay available for this dan' },
            { status: 404 }
          );
        }

        const replayFilePath = currentAttempt.dan.goldClearReplay.filePath;

        if (!replayFilePath || !existsSync(replayFilePath)) {
          return NextResponse.json(
            { error: 'Gold clear replay file not found' },
            { status: 404 }
          );
        }

        let timeSeries;
        try {
          console.log(`[Rival:GoldClear] Parsing replay file: ${replayFilePath}`);
          timeSeries = await parseReplayToTimeSeries(replayFilePath, currentBeatmap.beatmapId);
        } catch (error) {
          console.error('[Rival:GoldClear] Replay parsing failed:', error);
          return NextResponse.json(
            {
              error: 'Failed to parse gold clear replay',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
          );
        }

        // Get final score from parsed time series
        const finalScore = timeSeries[timeSeries.length - 1]?.score || 0;

        return NextResponse.json({
          beatmapId: currentBeatmap.beatmapId,
          duration,
          finalScore,
          timeSeries: timeSeries.map(({ time, score, combo, accuracy }) => ({
            time,
            score,
            combo,
            accuracy,
          })),
          rivalName: 'Gold Clear',
        });
      }

      case 'national': {
        // Query top score from leaderboard for this beatmap
        const topAttempt = await prisma.attempt.findFirst({
          where: {
            danId: currentAttempt.danId,
            status: 'COMPLETED',
            id: { not: attemptId },
          },
          include: {
            scores: {
              where: {
                beatmapId: currentBeatmap.id,
              },
            },
            user: true,
            replay: true,
          },
          orderBy: {
            totalScore: 'desc',
          },
        });

        if (!topAttempt || !topAttempt.scores[0]) {
          return NextResponse.json(
            { error: 'No national scores found for this beatmap' },
            { status: 404 }
          );
        }

        const topScore = topAttempt.scores[0];
        const replayFilePath = topAttempt.replay?.filePath;

        if (!replayFilePath || !existsSync(replayFilePath)) {
          return NextResponse.json(
            { error: 'Replay file not found for national best attempt' },
            { status: 404 }
          );
        }

        let timeSeries;
        try {
          console.log(`[Rival:National] Parsing replay file: ${replayFilePath}`);
          timeSeries = await parseReplayToTimeSeries(replayFilePath, currentBeatmap.beatmapId);
        } catch (error) {
          console.error('[Rival:National] Replay parsing failed:', error);
          return NextResponse.json(
            {
              error: 'Failed to parse national best replay',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
          );
        }

        return NextResponse.json({
          beatmapId: currentBeatmap.beatmapId,
          duration,
          finalScore: Number(topScore.score),
          timeSeries: timeSeries.map(({ time, score, combo, accuracy }) => ({
            time,
            score,
            combo,
            accuracy,
          })),
          rivalName: `#1 ${topAttempt.user.osuUsername || 'National'}`,
        });
      }

      case 'friends':
      case 'same-rank':
      case 'rotate': {
        // Not implemented yet - friend system not available
        return NextResponse.json(
          {
            error: `Rival mode '${mode}' not yet implemented`,
            message: 'Friend system is coming in a future update',
          },
          { status: 501 }
        );
      }

      default: {
        return NextResponse.json(
          {
            error: 'Invalid rival mode',
            validModes: ['clear', 'gold-clear', 'national', 'friends', 'same-rank', 'rotate'],
          },
          { status: 400 }
        );
      }
    }
  } catch (error) {
    console.error('[Rival] API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
