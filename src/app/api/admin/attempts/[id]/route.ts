import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth/admin-auth';
import { adminDiagnosticsService } from '@/lib/services/AdminDiagnosticsService';

/**
 * GET /api/admin/attempts/:id
 * Inspect attempt state for admin oversight
 * Returns DB record + Redis state + diagnostics
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdminSession();
    if (!adminCheck.ok) return adminCheck.res;

    const { id } = await params;
    const attemptId = parseInt(id, 10);

    if (isNaN(attemptId)) {
      return NextResponse.json({ error: 'Invalid attempt ID' }, { status: 400 });
    }

    // Delegate to service layer
    const inspection = await adminDiagnosticsService.inspectAttempt(attemptId);

    return NextResponse.json(inspection);
  } catch (error) {
    console.error('[AdminAPI] Inspection error:', error);

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
