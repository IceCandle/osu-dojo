-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ScoringSystem" AS ENUM ('SCORE_V2', 'LAZER');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('OSU', 'TAIKO', 'CATCH', 'MANIA');

-- CreateEnum
CREATE TYPE "DanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "osuId" INTEGER NOT NULL,
    "osuUsername" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "countryCode" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "currentDanRank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dans" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "difficultyTier" INTEGER NOT NULL,
    "gameMode" "GameMode" NOT NULL DEFAULT 'OSU',
    "creatorId" INTEGER NOT NULL,
    "allowedBans" INTEGER NOT NULL DEFAULT 0,
    "requiredMaps" INTEGER NOT NULL DEFAULT 4,
    "status" "DanStatus" NOT NULL DEFAULT 'DRAFT',
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "totalAttempts" INTEGER NOT NULL DEFAULT 0,
    "totalPasses" INTEGER NOT NULL DEFAULT 0,
    "uniquePlayers" INTEGER NOT NULL DEFAULT 0,
    "passReplayId" INTEGER,
    "goldClearReplayId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "dans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beatmaps" (
    "id" SERIAL NOT NULL,
    "danId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "beatmapId" INTEGER NOT NULL,
    "beatmapTitle" TEXT,
    "beatmapArtist" TEXT,
    "beatmapVersion" TEXT,
    "beatmapCreator" TEXT,
    "gameMode" "GameMode" NOT NULL DEFAULT 'OSU',
    "mods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scoringSystem" "ScoringSystem" NOT NULL DEFAULT 'SCORE_V2',
    "requiredScore" BIGINT NOT NULL,
    "goldClearScore" BIGINT NOT NULL,
    "isCandidate" BOOLEAN NOT NULL DEFAULT false,
    "candidateGroup" INTEGER,
    "skillFocus" TEXT,
    "estimatedStars" DOUBLE PRECISION,
    "length" INTEGER,
    "bpm" DOUBLE PRECISION,
    "ar" DOUBLE PRECISION,
    "cs" DOUBLE PRECISION,
    "od" DOUBLE PRECISION,
    "hp" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beatmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "danId" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "bannedMapIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "bannedCount" INTEGER NOT NULL DEFAULT 0,
    "currentMapIndex" INTEGER NOT NULL DEFAULT 0,
    "mapsCompleted" INTEGER NOT NULL DEFAULT 0,
    "mapsRequired" INTEGER NOT NULL,
    "totalScore" BIGINT NOT NULL DEFAULT 0,
    "averageAccuracy" DOUBLE PRECISION,
    "isPassed" BOOLEAN NOT NULL DEFAULT false,
    "failedMapId" INTEGER,
    "isNormalPass" BOOLEAN NOT NULL DEFAULT false,
    "isGoldPass" BOOLEAN NOT NULL DEFAULT false,
    "multiplayerId" TEXT,
    "multiplayerUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_scores" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "beatmapId" INTEGER NOT NULL,
    "score" BIGINT NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "combo" INTEGER NOT NULL,
    "count300" INTEGER NOT NULL DEFAULT 0,
    "count100" INTEGER NOT NULL DEFAULT 0,
    "count50" INTEGER NOT NULL DEFAULT 0,
    "countMiss" INTEGER NOT NULL DEFAULT 0,
    "countGeki" INTEGER NOT NULL DEFAULT 0,
    "countKatu" INTEGER NOT NULL DEFAULT 0,
    "sliderbreaks" INTEGER NOT NULL DEFAULT 0,
    "effectiveMisses" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL,
    "metRequirement" BOOLEAN NOT NULL,
    "modsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replays" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "danId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "fileUrl" TEXT,
    "fileSize" INTEGER,
    "isGoldClear" BOOLEAN NOT NULL DEFAULT false,
    "isPacemaker" BOOLEAN NOT NULL DEFAULT false,
    "totalScore" BIGINT NOT NULL,
    "averageAccuracy" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_osuId_key" ON "users"("osuId");

-- CreateIndex
CREATE INDEX "users_osuId_idx" ON "users"("osuId");

-- CreateIndex
CREATE INDEX "users_osuUsername_idx" ON "users"("osuUsername");

-- CreateIndex
CREATE UNIQUE INDEX "dans_passReplayId_key" ON "dans"("passReplayId");

-- CreateIndex
CREATE UNIQUE INDEX "dans_goldClearReplayId_key" ON "dans"("goldClearReplayId");

-- CreateIndex
CREATE INDEX "dans_creatorId_idx" ON "dans"("creatorId");

-- CreateIndex
CREATE INDEX "dans_status_difficultyTier_idx" ON "dans"("status", "difficultyTier");

-- CreateIndex
CREATE INDEX "dans_isFeatured_status_idx" ON "dans"("isFeatured", "status");

-- CreateIndex
CREATE INDEX "dans_publishedAt_idx" ON "dans"("publishedAt");

-- CreateIndex
CREATE INDEX "beatmaps_danId_idx" ON "beatmaps"("danId");

-- CreateIndex
CREATE INDEX "beatmaps_beatmapId_idx" ON "beatmaps"("beatmapId");

-- CreateIndex
CREATE INDEX "beatmaps_skillFocus_idx" ON "beatmaps"("skillFocus");

-- CreateIndex
CREATE UNIQUE INDEX "beatmaps_danId_orderIndex_key" ON "beatmaps"("danId", "orderIndex");

-- CreateIndex
CREATE INDEX "attempts_userId_danId_idx" ON "attempts"("userId", "danId");

-- CreateIndex
CREATE INDEX "attempts_danId_status_idx" ON "attempts"("danId", "status");

-- CreateIndex
CREATE INDEX "attempts_userId_status_idx" ON "attempts"("userId", "status");

-- CreateIndex
CREATE INDEX "attempts_danId_isPassed_totalScore_idx" ON "attempts"("danId", "isPassed", "totalScore");

-- CreateIndex
CREATE INDEX "attempts_createdAt_idx" ON "attempts"("createdAt");

-- CreateIndex
CREATE INDEX "attempt_scores_attemptId_idx" ON "attempt_scores"("attemptId");

-- CreateIndex
CREATE INDEX "attempt_scores_beatmapId_idx" ON "attempt_scores"("beatmapId");

-- CreateIndex
CREATE INDEX "attempt_scores_passed_metRequirement_idx" ON "attempt_scores"("passed", "metRequirement");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_scores_attemptId_beatmapId_key" ON "attempt_scores"("attemptId", "beatmapId");

-- CreateIndex
CREATE UNIQUE INDEX "replays_attemptId_key" ON "replays"("attemptId");

-- CreateIndex
CREATE INDEX "replays_userId_idx" ON "replays"("userId");

-- CreateIndex
CREATE INDEX "replays_danId_isGoldClear_idx" ON "replays"("danId", "isGoldClear");

-- CreateIndex
CREATE INDEX "replays_totalScore_idx" ON "replays"("totalScore");

-- AddForeignKey
ALTER TABLE "dans" ADD CONSTRAINT "dans_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dans" ADD CONSTRAINT "dans_passReplayId_fkey" FOREIGN KEY ("passReplayId") REFERENCES "replays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dans" ADD CONSTRAINT "dans_goldClearReplayId_fkey" FOREIGN KEY ("goldClearReplayId") REFERENCES "replays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beatmaps" ADD CONSTRAINT "beatmaps_danId_fkey" FOREIGN KEY ("danId") REFERENCES "dans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_danId_fkey" FOREIGN KEY ("danId") REFERENCES "dans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_scores" ADD CONSTRAINT "attempt_scores_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_scores" ADD CONSTRAINT "attempt_scores_beatmapId_fkey" FOREIGN KEY ("beatmapId") REFERENCES "beatmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replays" ADD CONSTRAINT "replays_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replays" ADD CONSTRAINT "replays_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
