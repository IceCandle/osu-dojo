-- Drop deprecated Attempt.isPassed remnants
-- Idempotent: safe to run even if already removed.

DROP INDEX IF EXISTS "attempts_danId_isPassed_totalScore_idx";
ALTER TABLE "attempts" DROP COLUMN IF EXISTS "isPassed";
