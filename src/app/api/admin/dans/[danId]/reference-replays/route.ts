import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminSession } from '@/lib/admin-auth';

type AttachKind = 'PASS' | 'GOLD';

function isAttachKind(value: unknown): value is AttachKind {
  return value === 'PASS' || value === 'GOLD';
}

/**
 * POST /api/admin/dans/:danId/reference-replays
 * Attach an existing Replay record as this dan's PASS or GOLD reference replay.
 *
 * Body:
 *  { kind: 'PASS'|'GOLD', replayId: number }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ danId: string }> }) {
  try {
    const adminCheck = await requireAdminSession();
    if (!adminCheck.ok) return adminCheck.res;

    const { danId: danIdStr } = await params;
    const danId = Number.parseInt(danIdStr, 10);

    if (!Number.isFinite(danId)) {
      return NextResponse.json({ error: 'Invalid danId' }, { status: 400 });
    }

    const body = (await request.json()) as unknown;
    const record = (body ?? {}) as Record<string, unknown>;

    const replayId = Number.parseInt(String(record.replayId ?? ''), 10);
    const kind = record.kind;

    if (!Number.isFinite(replayId) || !isAttachKind(kind)) {
      return NextResponse.json(
        { error: 'Invalid body. Expected { kind: PASS|GOLD, replayId: number }' },
        { status: 400 },
      );
    }

    const dan = await prisma.dan.findUnique({ where: { id: danId }, select: { id: true } });
    if (!dan) {
      return NextResponse.json({ error: 'Dan not found' }, { status: 404 });
    }

    const replay = await prisma.replay.findUnique({ where: { id: replayId }, select: { id: true, danId: true } });
    if (!replay) {
      return NextResponse.json({ error: 'Replay not found' }, { status: 404 });
    }

    if (replay.danId !== danId) {
      return NextResponse.json(
        { error: 'Replay does not belong to this dan', details: { replayDanId: replay.danId, danId } },
        { status: 400 },
      );
    }

    const data =
      kind === 'PASS'
        ? { passReplayId: replayId }
        : { goldClearReplayId: replayId };

    const updated = await prisma.dan.update({
      where: { id: danId },
      data,
      select: { id: true, passReplayId: true, goldClearReplayId: true },
    });

    return NextResponse.json({ success: true, dan: updated }, { status: 200 });
  } catch (error) {
    console.error('[AdminReferenceReplays] Attach failed:', error);
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
 * DELETE /api/admin/dans/:danId/reference-replays?kind=PASS|GOLD
 * Detach the reference replay.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ danId: string }> },
) {
  try {
    const adminCheck = await requireAdminSession();
    if (!adminCheck.ok) return adminCheck.res;

    const { danId: danIdStr } = await params;
    const danId = Number.parseInt(danIdStr, 10);

    if (!Number.isFinite(danId)) {
      return NextResponse.json({ error: 'Invalid danId' }, { status: 400 });
    }

    const kindParam = request.nextUrl.searchParams.get('kind');
    if (!isAttachKind(kindParam)) {
      return NextResponse.json({ error: 'Missing/invalid kind query param (PASS|GOLD)' }, { status: 400 });
    }

    const data = kindParam === 'PASS' ? { passReplayId: null } : { goldClearReplayId: null };

    const updated = await prisma.dan.update({
      where: { id: danId },
      data,
      select: { id: true, passReplayId: true, goldClearReplayId: true },
    });

    return NextResponse.json({ success: true, dan: updated }, { status: 200 });
  } catch (error) {
    console.error('[AdminReferenceReplays] Detach failed:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
