import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth/admin-auth';
import { adminDiagnosticsService } from '@/lib/services/AdminDiagnosticsService';

/**
 * POST /api/admin/attempts/:id/restart
 * Manually restart a stuck attempt
 * Cleans up Redis state and re-queues the attempt
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdminSession();
    if (!adminCheck.ok) return adminCheck.res;

    const { id } = await params;
    const attemptId = parseInt(id, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }

    // Delegate to service layer
    const result = await adminDiagnosticsService.restartAttempt(attemptId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[AdminAPI] Restart error:', error);

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
