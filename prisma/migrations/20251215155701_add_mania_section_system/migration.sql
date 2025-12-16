-- CreateEnum
CREATE TYPE "SectionAccuracySource" AS ENUM ('MANUAL', 'TOSU_OVERLAY', 'REPLAY_PARSED');

-- AlterTable
ALTER TABLE "beatmaps" ADD COLUMN     "hasSections" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "dans" ADD COLUMN     "danSystemKey" TEXT,
ADD COLUMN     "requiresReplay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tierInSystem" INTEGER;

-- CreateTable
CREATE TABLE "beatmap_sections" (
    "id" SERIAL NOT NULL,
    "beatmapId" INTEGER NOT NULL,
    "sectionIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "mapper" TEXT,
    "difficultyName" TEXT,
    "noteCount" INTEGER NOT NULL,
    "lnCount" INTEGER NOT NULL DEFAULT 0,
    "startTime" INTEGER,
    "endTime" INTEGER,
    "skillFocus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beatmap_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_score_sections" (
    "id" SERIAL NOT NULL,
    "attemptScoreId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "source" "SectionAccuracySource" NOT NULL DEFAULT 'MANUAL',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_score_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "beatmap_sections_beatmapId_idx" ON "beatmap_sections"("beatmapId");

-- CreateIndex
CREATE UNIQUE INDEX "beatmap_sections_beatmapId_sectionIndex_key" ON "beatmap_sections"("beatmapId", "sectionIndex");

-- CreateIndex
CREATE INDEX "attempt_score_sections_attemptScoreId_idx" ON "attempt_score_sections"("attemptScoreId");

-- CreateIndex
CREATE INDEX "attempt_score_sections_sectionId_idx" ON "attempt_score_sections"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_score_sections_attemptScoreId_sectionId_key" ON "attempt_score_sections"("attemptScoreId", "sectionId");

-- CreateIndex
CREATE INDEX "dans_danSystemKey_tierInSystem_idx" ON "dans"("danSystemKey", "tierInSystem");

-- CreateIndex
CREATE INDEX "dans_gameMode_danSystemKey_idx" ON "dans"("gameMode", "danSystemKey");

-- AddForeignKey
ALTER TABLE "beatmap_sections" ADD CONSTRAINT "beatmap_sections_beatmapId_fkey" FOREIGN KEY ("beatmapId") REFERENCES "beatmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_score_sections" ADD CONSTRAINT "attempt_score_sections_attemptScoreId_fkey" FOREIGN KEY ("attemptScoreId") REFERENCES "attempt_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_score_sections" ADD CONSTRAINT "attempt_score_sections_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "beatmap_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
