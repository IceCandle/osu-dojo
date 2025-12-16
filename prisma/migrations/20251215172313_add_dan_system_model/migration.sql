/*
  Warnings:

  - You are about to drop the column `danSystemKey` on the `dans` table. All the data in the column will be lost.
  - You are about to drop the column `requiredMaps` on the `dans` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "dans_danSystemKey_tierInSystem_idx";

-- DropIndex
DROP INDEX "dans_gameMode_danSystemKey_idx";

-- AlterTable
ALTER TABLE "dans" DROP COLUMN "danSystemKey",
DROP COLUMN "requiredMaps",
ADD COLUMN     "danSystemId" INTEGER;

-- CreateTable
CREATE TABLE "dan_systems" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "gameMode" "GameMode" NOT NULL,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "creatorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dan_systems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dan_systems_key_key" ON "dan_systems"("key");

-- CreateIndex
CREATE INDEX "dan_systems_gameMode_isOfficial_idx" ON "dan_systems"("gameMode", "isOfficial");

-- CreateIndex
CREATE INDEX "dan_systems_creatorId_idx" ON "dan_systems"("creatorId");

-- CreateIndex
CREATE INDEX "dans_danSystemId_tierInSystem_idx" ON "dans"("danSystemId", "tierInSystem");

-- CreateIndex
CREATE INDEX "dans_gameMode_danSystemId_idx" ON "dans"("gameMode", "danSystemId");

-- AddForeignKey
ALTER TABLE "dan_systems" ADD CONSTRAINT "dan_systems_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dans" ADD CONSTRAINT "dans_danSystemId_fkey" FOREIGN KEY ("danSystemId") REFERENCES "dan_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;
