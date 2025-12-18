-- AlterTable
ALTER TABLE "beatmaps" ADD COLUMN     "goldMaxMisses" INTEGER,
ADD COLUMN     "goldMinCombo" INTEGER,
ADD COLUMN     "goldRequiredAccuracy" DOUBLE PRECISION,
ADD COLUMN     "maxMisses" INTEGER,
ADD COLUMN     "minCombo" INTEGER,
ADD COLUMN     "requiredAccuracy" DOUBLE PRECISION;
