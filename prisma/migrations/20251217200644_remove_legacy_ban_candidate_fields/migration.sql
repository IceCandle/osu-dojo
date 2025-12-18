/*
  Warnings:

  - You are about to drop the column `bannedCount` on the `attempts` table. All the data in the column will be lost.
  - You are about to drop the column `bannedMapIds` on the `attempts` table. All the data in the column will be lost.
  - You are about to drop the column `candidateGroup` on the `beatmaps` table. All the data in the column will be lost.
  - You are about to drop the column `isCandidate` on the `beatmaps` table. All the data in the column will be lost.
  - You are about to drop the column `allowedBans` on the `dans` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "attempts" DROP COLUMN "bannedCount",
DROP COLUMN "bannedMapIds";

-- AlterTable
ALTER TABLE "beatmaps" DROP COLUMN "candidateGroup",
DROP COLUMN "isCandidate";

-- AlterTable
ALTER TABLE "dans" DROP COLUMN "allowedBans";
