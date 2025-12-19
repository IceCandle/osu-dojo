import type { Attempt } from '@prisma/client';

export type AttemptOutcome = 'IN_PROGRESS' | 'ABANDONED' | 'PASSED' | 'FAILED';

export type AttemptOutcomeDetailed =
  | 'IN_PROGRESS'
  | 'ABANDONED'
  | 'PASSED_NORMAL'
  | 'PASSED_GOLD'
  | 'FINISHED_NO_CLEAR';

type AttemptOutcomeInput = Pick<Attempt, 'status' | 'isNormalPass' | 'isGoldPass'>;

/**
 * Derive a domain-level outcome from persisted attempt fields.
 *
 * Prisma models "failed" attempts as `status = COMPLETED` with pass flags remaining false.
 */
export function getAttemptOutcome(attempt: AttemptOutcomeInput): AttemptOutcome {
  if (attempt.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (attempt.status === 'ABANDONED') return 'ABANDONED';

  // status === 'COMPLETED'
  return attempt.isNormalPass || attempt.isGoldPass ? 'PASSED' : 'FAILED';
}

/**
 * Like `getAttemptOutcome`, but preserves extra detail that you may want for UX later.
 *
 * Distinctions supported with current schema:
 * - ABANDONED: did not finish the course (disconnect/DNF/restart/etc.)
 * - FINISHED_NO_CLEAR: finished all maps but did not earn a clear
 * - PASSED_NORMAL / PASSED_GOLD: two-tier clear system
 */
export function getAttemptOutcomeDetailed(attempt: AttemptOutcomeInput): AttemptOutcomeDetailed {
  if (attempt.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (attempt.status === 'ABANDONED') return 'ABANDONED';

  // status === 'COMPLETED'
  if (attempt.isGoldPass) return 'PASSED_GOLD';
  if (attempt.isNormalPass) return 'PASSED_NORMAL';
  return 'FINISHED_NO_CLEAR';
}
