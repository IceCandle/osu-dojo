import 'server-only';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth-options';

export type AdminSessionResult =
  | { ok: true; user: { id: number; osuId: number } }
  | { ok: false; res: NextResponse };

export async function requireAdminSession(): Promise<AdminSessionResult> {
  const session = await getServerSession(authOptions);
  const osuId = (session?.user as unknown as { osuId?: number } | undefined)?.osuId;

  if (typeof osuId !== 'number' || !Number.isFinite(osuId)) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { osuId },
    select: { id: true, role: true },
  });

  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (user.role !== 'ADMIN') {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { ok: true, user: { id: user.id, osuId } };
}
