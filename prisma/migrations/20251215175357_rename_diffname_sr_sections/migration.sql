/*
  Warnings:

  - You are about to drop the column `beatmapVersion` on the `beatmaps` table. All the data in the column will be lost.
  - You are about to drop the column `estimatedStars` on the `beatmaps` table. All the data in the column will be lost.
  - You are about to drop the `attempt_score_sections` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "attempt_score_sections" DROP CONSTRAINT "attempt_score_sections_attemptScoreId_fkey";

-- DropForeignKey
ALTER TABLE "attempt_score_sections" DROP CONSTRAINT "attempt_score_sections_sectionId_fkey";

-- AlterTable
ALTER TABLE "beatmaps" DROP COLUMN "beatmapVersion",
DROP COLUMN "estimatedStars",
ADD COLUMN     "difficultyName" TEXT,
ADD COLUMN     "starRating" DOUBLE PRECISION;

-- DropTable
DROP TABLE "attempt_score_sections";

-- CreateTable
CREATE TABLE "section_scores" (
    "id" SERIAL NOT NULL,
    "attemptScoreId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "source" "SectionAccuracySource" NOT NULL DEFAULT 'MANUAL',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "section_scores_attemptScoreId_idx" ON "section_scores"("attemptScoreId");

-- CreateIndex
CREATE INDEX "section_scores_sectionId_idx" ON "section_scores"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "section_scores_attemptScoreId_sectionId_key" ON "section_scores"("attemptScoreId", "sectionId");

-- AddForeignKey
ALTER TABLE "section_scores" ADD CONSTRAINT "section_scores_attemptScoreId_fkey" FOREIGN KEY ("attemptScoreId") REFERENCES "attempt_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_scores" ADD CONSTRAINT "section_scores_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "beatmap_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
