import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

/**
 * POST /api/attempts/:id/live-stats
 * Store live gameplay statistics from overlay (sliderbreaks, combo, etc.)
 * Bot will read this when saving scores to database
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const attemptId = parseInt(params.id, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json(
        { error: 'Invalid attempt ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { beatmapId, sliderbreaks, maxCombo, count300, count100, count50, countMiss } = body;

    // Validate required fields
    if (beatmapId === undefined || sliderbreaks === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: beatmapId, sliderbreaks' },
        { status: 400 }
      );
    }

    // Store in Redis with 1-hour TTL
    const key = `attempt:${attemptId}:live-stats:${beatmapId}`;
    await redis.setex(
      key,
      3600, // 1 hour TTL
      JSON.stringify({
        beatmapId,
        sliderbreaks,
        maxCombo,
        count300,
        count100,
        count50,
        countMiss,
        timestamp: Date.now(),
      })
    );

    console.log(`[LiveStats] Stored for attempt ${attemptId}, beatmap ${beatmapId}:`, {
      sliderbreaks,
      maxCombo,
    });

    return NextResponse.json({
      success: true,
      stored: { beatmapId, sliderbreaks },
    });

  } catch (error) {
    console.error('[LiveStats] API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/attempts/:id/live-stats?beatmapId=123
 * Retrieve stored live stats for a specific beatmap
 * Used by bot when saving scores
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const attemptId = parseInt(params.id, 10);
    const url = new URL(request.url);
    const beatmapId = url.searchParams.get('beatmapId');

    if (isNaN(attemptId) || !beatmapId) {
      return NextResponse.json(
        { error: 'Invalid attempt ID or missing beatmapId' },
        { status: 400 }
      );
    }

    // Retrieve from Redis
    const key = `attempt:${attemptId}:live-stats:${beatmapId}`;
    const data = await redis.get(key);

    if (!data) {
      return NextResponse.json(
        { error: 'Live stats not found (overlay may not be running)' },
        { status: 404 }
      );
    }

    return NextResponse.json(JSON.parse(data));

  } catch (error) {
    console.error('[LiveStats] GET error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
