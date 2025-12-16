-- CreateIndex
CREATE INDEX "attempts_danId_isNormalPass_totalScore_idx" ON "attempts"("danId", "isNormalPass", "totalScore");

-- CreateIndex
CREATE INDEX "attempts_danId_isGoldPass_totalScore_idx" ON "attempts"("danId", "isGoldPass", "totalScore");
