-- Track whether sliderbreaks were reported by overlay (tosu) or missing.
-- Idempotent: safe to run even if partially applied.

DO $$
BEGIN
  CREATE TYPE "SliderbreaksSource" AS ENUM ('TOSU_OVERLAY', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "attempt_scores"
  ADD COLUMN IF NOT EXISTS "sliderbreaksSource" "SliderbreaksSource" NOT NULL DEFAULT 'UNKNOWN';
