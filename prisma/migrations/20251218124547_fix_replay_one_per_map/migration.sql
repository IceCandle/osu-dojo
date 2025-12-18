/*
  Warnings:

  - Made the column `beatmapId` on table `replays` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "replays_attemptId_key";

-- AlterTable
ALTER TABLE "replays" ALTER COLUMN "beatmapId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "replays_danId_idx" ON "replays"("danId");
