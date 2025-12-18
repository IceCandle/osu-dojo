-- Fix Replay schema to support multiple replays per attempt (one per map)
-- Remove misleading fields and add proper constraints

-- Step 1: Drop existing constraints and indices
ALTER TABLE "replays" DROP CONSTRAINT IF EXISTS "replays_attemptId_key";
DROP INDEX IF EXISTS "replays_danId_isGoldClear_idx";
DROP INDEX IF EXISTS "replays_totalScore_idx";

-- Step 2: Add new columns
ALTER TABLE "replays" ADD COLUMN IF NOT EXISTS "beatmapId" INTEGER;
ALTER TABLE "replays" ADD COLUMN IF NOT EXISTS "score" BIGINT;
ALTER TABLE "replays" ADD COLUMN IF NOT EXISTS "replayTimestamp" TIMESTAMP(3);

-- Step 3: Migrate data from old columns to new columns
UPDATE "replays" SET "score" = "totalScore" WHERE "score" IS NULL;

-- Step 4: Drop old columns (after data migration)
ALTER TABLE "replays" DROP COLUMN IF EXISTS "isGoldClear";
ALTER TABLE "replays" DROP COLUMN IF EXISTS "totalScore";
ALTER TABLE "replays" DROP COLUMN IF EXISTS "averageAccuracy";
ALTER TABLE "replays" DROP COLUMN IF EXISTS "isPacemaker";

-- Step 5: Make new columns NOT NULL (after migration)
ALTER TABLE "replays" ALTER COLUMN "score" SET NOT NULL;

-- Step 6: Add foreign key constraint for beatmapId
ALTER TABLE "replays"
  ADD CONSTRAINT "replays_beatmapId_fkey"
  FOREIGN KEY ("beatmapId")
  REFERENCES "beatmaps"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Step 7: Create composite unique constraint (one replay per map per attempt)
CREATE UNIQUE INDEX "replays_attemptId_beatmapId_key" ON "replays"("attemptId", "beatmapId");

-- Step 8: Create new indices for queries
CREATE INDEX "replays_beatmapId_idx" ON "replays"("beatmapId");
CREATE INDEX "replays_score_idx" ON "replays"("score");
CREATE INDEX "replays_replayTimestamp_idx" ON "replays"("replayTimestamp");
