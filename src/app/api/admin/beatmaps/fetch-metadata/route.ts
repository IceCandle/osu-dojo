import { NextRequest, NextResponse } from 'next/server';
import { osuApi } from '@/lib/osu-api';
import { requireAdminSession } from '@/lib/admin-auth';

/**
 * POST /api/admin/beatmaps/fetch-metadata
 * Auto-fetch beatmap metadata from osu! API to ease dan creation workflow
 *
 * Request: { beatmapId: number }
 * Response: {
 *   beatmapId, beatmapTitle, beatmapArtist, difficultyName, beatmapCreator,
 *   length, bpm, ar, cs, od, hp, starRating
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const adminCheck = await requireAdminSession();
    if (!adminCheck.ok) return adminCheck.res;

    const { beatmapId } = await req.json();

    if (!beatmapId || typeof beatmapId !== 'number') {
      return NextResponse.json({ error: 'beatmapId (number) is required' }, { status: 400 });
    }

    const beatmap = await osuApi.getBeatmap(beatmapId);

    if (!beatmap) {
      return NextResponse.json(
        { error: `Beatmap ${beatmapId} not found on osu!` },
        { status: 404 },
      );
    }

    type Beatmapset = {
      title?: string;
      artist?: string;
      creator?: string;
    };
    type Beatmap = {
      id: number;
      version?: string;
      total_length?: number;
      bpm?: number;
      ar?: number;
      cs?: number;
      accuracy?: number;
      drain?: number;
      difficulty_rating?: number;
      beatmapset?: Beatmapset;
    };

    const beatmapData = beatmap as unknown as Partial<Beatmap>;
    if (typeof beatmapData.id !== 'number') {
      return NextResponse.json({ error: 'Unexpected osu! API response shape' }, { status: 502 });
    }

    const beatmapset = beatmapData.beatmapset ?? {};

    return NextResponse.json({
      beatmapId: beatmapData.id,
      beatmapTitle: beatmapset.title || 'Unknown Title',
      beatmapArtist: beatmapset.artist || 'Unknown Artist',
      difficultyName: beatmapData.version || 'Unknown Difficulty',
      beatmapCreator: beatmapset.creator || 'Unknown Creator',
      length: beatmapData.total_length || 0,
      bpm: beatmapData.bpm || 0,
      ar: beatmapData.ar ?? 0,
      cs: beatmapData.cs ?? 0,
      od: beatmapData.accuracy ?? 0,
      hp: beatmapData.drain ?? 0,
      starRating: beatmapData.difficulty_rating ?? 0,
    });
  } catch (error) {
    console.error('Failed to fetch beatmap metadata:', error);
    return NextResponse.json(
      { error: 'Failed to fetch beatmap metadata. osu! API may be unavailable.' },
      { status: 500 },
    );
  }
}
