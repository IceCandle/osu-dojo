import { NextRequest, NextResponse } from 'next/server';
import { myBestService } from '@/lib/services/MyBestService';

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
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const attemptId = parseInt(id, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }

    // Delegate to service layer
    const response = await myBestService.getMyBestTimeSeries(attemptId);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[MyBest] API error:', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    // Map service errors to HTTP status codes
    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 });
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
