/*
  Warnings:

  - A unique constraint covering the columns `[danSystemId,tierInSystem,variantIndex]` on the table `dans` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "dans" ADD COLUMN     "variantIndex" INTEGER NOT NULL DEFAULT 1;

-- Backfill variantIndex for existing rows so the unique constraint can be added safely.
-- For each certificate key (danSystemId, tierInSystem), assign variantIndex = 1..N ordered by id.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "danSystemId", "tierInSystem" ORDER BY id) AS rn
  FROM "dans"
  WHERE "danSystemId" IS NOT NULL AND "tierInSystem" IS NOT NULL
)
UPDATE "dans" d
SET "variantIndex" = ranked.rn
FROM ranked
WHERE d.id = ranked.id;

-- CreateIndex
CREATE UNIQUE INDEX "dans_danSystemId_tierInSystem_variantIndex_key" ON "dans"("danSystemId", "tierInSystem", "variantIndex");
