import { NextRequest, NextResponse } from 'next/server';
import { rivalScoreService, type RivalMode } from '@/lib/services/RivalScoreService';

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
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const attemptId = parseInt(id, 10);
    const searchParams = request.nextUrl.searchParams;
    const mode = (searchParams.get('mode') || 'clear') as RivalMode;

    if (isNaN(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }

    // Delegate to service layer
    const response = await rivalScoreService.getRivalTimeSeries(attemptId, mode);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Rival] API error:', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    // Map service errors to HTTP status codes
    if (message.includes('not yet implemented')) {
      return NextResponse.json(
        {
          error: message,
          message: 'Friend system is coming in a future update',
        },
        { status: 501 },
      );
    }

    if (
      message.includes('not found') ||
      message.includes('No gold clear') ||
      message.includes('No national')
    ) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message.includes('Invalid rival mode')) {
      return NextResponse.json(
        {
          error: message,
          validModes: ['clear', 'gold-clear', 'national', 'friends', 'same-rank', 'rotate'],
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message,
      },
      { status: 500 },
    );
  }
}
