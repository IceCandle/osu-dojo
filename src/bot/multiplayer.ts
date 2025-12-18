import BanchoJs from 'bancho.js';
import { createLogger } from '@/lib/core/logger';
import type { MatchScore } from '@/types/bancho-overrides';
import type { AttemptConfig, MapScore } from '@/types/bot-types';
import { LOBBY_MESSAGES } from '@/bot/messages';
import {
  evaluateBeatmapRequirements,
  formatRequirementFailures,
} from '@/lib/beatmap-requirements';

/**
 * Manages a single dan attempt in a multiplayer room
 */
export class MultiplayerManager {
  private lobby: BanchoJs.BanchoLobby;
  private config: AttemptConfig;
  private currentMapIndex: number = 0;
  private scores: MapScore[] = [];
  private playerJoined: boolean = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logger = createLogger('MultiplayerManager');

  constructor(lobby: BanchoJs.BanchoLobby, config: AttemptConfig) {
    this.lobby = lobby;
    this.config = config;
    if (typeof config.startMapIndex === 'number' && Number.isFinite(config.startMapIndex)) {
      this.currentMapIndex = Math.max(0, Math.floor(config.startMapIndex));
    }
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Player joined event
    this.lobby.on('playerJoined', async (obj: { player: { user: { username: string } } }) => {
      const joinedUsername = obj.player.user.username;
      console.log(LOBBY_MESSAGES.playerJoined(joinedUsername));

      if (joinedUsername === this.config.username) {
        this.playerJoined = true;
        await this.onPlayerReady();
      }
    });

    // Match finished event - automatic progression to next map
    this.lobby.on('matchFinished', async (scores: MatchScore[]) => {
      await this.onMatchFinished(scores);
    });

    // Player left event
    this.lobby.on('playerLeft', async (obj: { user: { username: string } }) => {
      const leftUsername = obj.user.username;
      console.log(LOBBY_MESSAGES.playerLeft(leftUsername));

      if (leftUsername === this.config.username) {
        console.log(LOBBY_MESSAGES.targetPlayerLeft);

        this.logger.warn('Target player disconnected, abandoning attempt', {
          attemptId: this.config.attemptId,
          username: this.config.username,
          currentMapIndex: this.currentMapIndex,
          mapsCompleted: this.scores.length,
        });

        // Publish disconnect event (if Pub/Sub implemented)
        try {
          const { publishAttemptEvent } = await import('@/lib/core/redis');
          await publishAttemptEvent(this.config.attemptId, 'ATTEMPT_FAILED', {
            attemptId: this.config.attemptId,
            reason: 'player_disconnected',
            currentMapIndex: this.currentMapIndex,
            mapsCompleted: this.scores.length,
            timestamp: Date.now(),
          });
        } catch (error) {
          this.logger.warn('Failed to publish disconnect event', { error });
        }

        // Reuse existing cleanup logic via finishAttempt()
        await this.finishAttempt();
      }
    });
  }

  /**
   * Start the attempt flow
   */
  async start(): Promise<void> {
    console.log(`Starting attempt for ${this.config.username} - ${this.config.danName}`);

    this.startHeartbeat();

    // Invite the player
    await this.lobby.invitePlayer(this.config.username);

    // Set a timeout for player to join (5 minutes)
    setTimeout(
      () => {
        if (!this.playerJoined) {
          console.log(LOBBY_MESSAGES.playerDidNotJoin);
          this.lobby.closeLobby();
        }
      },
      5 * 60 * 1000,
    );
  }

  private async onPlayerReady(): Promise<void> {
    console.log('Player is ready. Starting attempt flow.');

    // Maps have already been selected in processAttempt
    // Just start playing the first map
    await this.playNextMap();
  }

  private startHeartbeat(): void {
    if (!this.config.multiplayerId || this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(async () => {
      try {
        const { updateHeartbeat } = await import('./recovery');
        await updateHeartbeat(this.config.multiplayerId!);
      } catch (error) {
        this.logger.warn('Heartbeat update failed', { error });
      }
    }, 60_000);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async syncLobbyProgress(): Promise<void> {
    if (!this.config.multiplayerId) return;

    const { getLobbyState, saveLobbyState } = await import('./recovery');
    const state = await getLobbyState(this.config.multiplayerId);
    if (!state) return;

    await saveLobbyState(this.config.multiplayerId, {
      ...state,
      currentMapIndex: this.currentMapIndex,
      mapsCompleted: this.scores.length,
      lastHeartbeat: Date.now(),
    });

    try {
      const { prisma } = await import('@/lib/core/prisma');
      await prisma.attempt.update({
        where: { id: this.config.attemptId },
        data: {
          currentMapIndex: this.currentMapIndex,
          mapsCompleted: this.scores.length,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to persist attempt progress', { error });
    }
  }

  private async playNextMap(): Promise<void> {
    if (this.currentMapIndex >= this.config.maps.length) {
      await this.finishAttempt();
      return;
    }

    await this.syncLobbyProgress();

    const map = this.config.maps[this.currentMapIndex];
    console.log(
      `Playing map ${this.currentMapIndex + 1}/${this.config.maps.length}: ${map.beatmapId}`,
    );

    // ATTEMPT_STARTED semantics: publish exactly when the first map begins.
    if (this.currentMapIndex === 0) {
      try {
        const { publishAttemptEvent } = await import('@/lib/core/redis');
        await publishAttemptEvent(this.config.attemptId, 'ATTEMPT_STARTED', {
          attemptId: this.config.attemptId,
          multiplayerId: this.config.multiplayerId,
          username: this.config.username,
          danName: this.config.danName,
          beatmapId: map.beatmapId,
          mapIndex: 0,
          timestamp: Date.now(),
        });
      } catch (error) {
        this.logger.warn('Failed to publish ATTEMPT_STARTED event', { error });
      }
    }

    // Publish map changed event
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');
      await publishAttemptEvent(this.config.attemptId, 'MAP_CHANGED', {
        attemptId: this.config.attemptId,
        currentMapIndex: this.currentMapIndex,
        totalMaps: this.config.maps.length,
        beatmapId: map.beatmapId,
        beatmapName: map.name || `Map ${this.currentMapIndex + 1}`,
        mods: map.mods,
        requiredScore: map.requiredScore.toString(),
        goldClearScore: map.goldClearScore.toString(),
        skillFocus: map.skillFocus,
        gameMode: map.gameMode,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.warn('Failed to publish MAP_CHANGED event', { error });
    }

    // Set beatmap
    await this.lobby.setMap(map.beatmapId);

    // Set mods
    if (map.mods.length > 0) {
      await this.lobby.setMods(map.mods.join(''), false); // false = not freemod
    }

    // Start match immediately (minimal rest time as requested)
    await this.lobby.startMatch(5); // 5 second countdown
  }

  private async onMatchFinished(scores: MatchScore[]): Promise<void> {
    this.logger.info('Match finished, processing scores');

    // Find the player's score
    const playerScore = scores.find((s) => s.player.user.username === this.config.username);

    if (playerScore) {
      const currentMap = this.config.maps[this.currentMapIndex];
      const score = BigInt(playerScore.score);

      const mapScore: MapScore = {
        beatmapId: currentMap.id, // Use DB primary key
        score,
        passed: playerScore.pass,
        accuracy: playerScore.accuracy,
        combo: playerScore.maxCombo,
        count300: playerScore.count300 || 0,
        count100: playerScore.count100 || 0,
        count50: playerScore.count50 || 0,
        countMiss: playerScore.countMiss || 0,
        metRequirement: true, // computed in saveScoreToDatabase (may use effective misses)
      };

      // Save score to database (also computes metRequirement using optional metric requirements)
      const persisted = await this.saveScoreToDatabase(mapScore);
      mapScore.metRequirement = persisted.metRequirement;
      mapScore.effectiveMisses = persisted.effectiveMisses;

      this.scores.push(mapScore);

      this.logger.info('Score recorded', {
        beatmapId: currentMap.beatmapId,
        score: score.toString(),
        passed: mapScore.passed,
        metRequirement: mapScore.metRequirement,
      });

      // End attempt immediately only on true failure (DNF / did not complete).
      // Policy: if the player finishes the map but scores below requiredScore,
      // we continue the course so they can practice the full dan.
      if (!mapScore.passed) {
        const failReason = LOBBY_MESSAGES.failureReason.didNotComplete;
        const mapName = currentMap.name || `Map ${this.currentMapIndex + 1}`;

        await this.lobby.channel.sendMessage(
          LOBBY_MESSAGES.mapFailed(mapName, currentMap.skillFocus ?? undefined, failReason),
        );

        // Publish attempt failed event
        try {
          const { publishAttemptEvent } = await import('@/lib/core/redis');
          await publishAttemptEvent(this.config.attemptId, 'ATTEMPT_FAILED', {
            attemptId: this.config.attemptId,
            failedAtMapIndex: this.currentMapIndex,
            totalMaps: this.config.maps.length,
            failReason: 'did_not_complete',
            score: score.toString(),
            requiredScore: currentMap.requiredScore.toString(),
            timestamp: Date.now(),
          });
        } catch (error) {
          this.logger.warn('Failed to publish ATTEMPT_FAILED event', { error });
        }

        await this.finishAttempt();
        return;
      }

      if (!mapScore.metRequirement) {
        const warnReason =
          persisted.failed.length === 1 && persisted.failed[0] === 'score'
            ? LOBBY_MESSAGES.failureReason.scoreTooLow(score, currentMap.requiredScore)
            : LOBBY_MESSAGES.failureReason.requirementsNotMet(
                formatRequirementFailures(persisted.failed),
              );
        const mapName = currentMap.name || `Map ${this.currentMapIndex + 1}`;

        await this.lobby.channel.sendMessage(
          LOBBY_MESSAGES.mapRequirementMissed(mapName, currentMap.skillFocus ?? undefined, warnReason),
        );

        // Do NOT publish ATTEMPT_FAILED here; the attempt continues.
      }

      // Passed this map! Show feedback
      await this.lobby.channel.sendMessage(
        LOBBY_MESSAGES.mapCleared(this.currentMapIndex, this.config.maps.length, score),
      );
    }

    // Move to next map automatically
    this.currentMapIndex++;
    await this.syncLobbyProgress();
    await this.playNextMap();
  }

  /**
   * Save individual map score to database
   * Called after each map completion
   */
  private async saveScoreToDatabase(mapScore: MapScore): Promise<{
    metRequirement: boolean;
    effectiveMisses: number;
    failed: Array<'score' | 'accuracy' | 'misses' | 'combo'>;
  }> {
    const { prisma } = await import('@/lib/core/prisma');
    const { redis } = await import('@/lib/core/redis');

    let sliderbreaks = 0;
    let effectiveMisses = mapScore.countMiss;
    let sliderbreaksSource: 'TOSU_OVERLAY' | 'UNKNOWN' = 'UNKNOWN';

    // Try to get sliderbreak data from overlay
    const beatmap = this.config.maps.find((m) => m.id === mapScore.beatmapId);

    if (beatmap?.gameMode === 'OSU') {
      const liveStatsKey = `attempt:${this.config.attemptId}:live-stats:${beatmap.beatmapId}`;
      const liveStatsData = await redis.get(liveStatsKey);

      if (liveStatsData) {
        const liveStats = JSON.parse(liveStatsData);
        sliderbreaks = liveStats.sliderbreaks || 0;
        effectiveMisses = mapScore.countMiss + sliderbreaks;
        sliderbreaksSource = 'TOSU_OVERLAY';

        this.logger.info('Sliderbreak data retrieved from overlay', {
          beatmapId: beatmap.beatmapId,
          sliderbreaks,
          effectiveMisses,
        });

        // Clean up after reading
        await redis.del(liveStatsKey);
      } else {
        this.logger.warn('No sliderbreak data from overlay - recording as UNKNOWN', {
          beatmapId: beatmap.beatmapId,
          note: 'AttemptScore.sliderbreaksSource=UNKNOWN; sliderbreaks default to 0',
        });
      }
    }

    const requirementEval = evaluateBeatmapRequirements(
      {
        requiredScore: beatmap?.requiredScore ?? BigInt(0),
        goldClearScore: beatmap?.goldClearScore ?? BigInt(0),
        requiredAccuracy: beatmap?.requiredAccuracy ?? null,
        maxMisses: beatmap?.maxMisses ?? null,
        minCombo: beatmap?.minCombo ?? null,
        goldRequiredAccuracy: beatmap?.goldRequiredAccuracy ?? null,
        goldMaxMisses: beatmap?.goldMaxMisses ?? null,
        goldMinCombo: beatmap?.goldMinCombo ?? null,
      },
      {
        score: mapScore.score,
        accuracy: mapScore.accuracy,
        combo: mapScore.combo,
        countMiss: mapScore.countMiss,
        effectiveMisses,
      },
      'normal',
    );

    // Save to database
    await prisma.attemptScore.create({
      data: {
        attemptId: this.config.attemptId,
        beatmapId: mapScore.beatmapId,
        score: mapScore.score,
        accuracy: mapScore.accuracy,
        combo: mapScore.combo,
        count300: mapScore.count300,
        count100: mapScore.count100,
        count50: mapScore.count50,
        countMiss: mapScore.countMiss,
        sliderbreaks,
        effectiveMisses,
        sliderbreaksSource,
        passed: mapScore.passed,
        metRequirement: requirementEval.met,
        modsUsed: beatmap?.mods || [],
        playedAt: new Date(),
      },
    });

    this.logger.info('Score saved to database', {
      attemptId: this.config.attemptId,
      beatmapId: mapScore.beatmapId,
      score: mapScore.score.toString(),
      sliderbreaks,
      passed: mapScore.passed,
    });

    // Publish score update event
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');
      await publishAttemptEvent(this.config.attemptId, 'SCORE_UPDATE', {
        attemptId: this.config.attemptId,
        beatmapId: mapScore.beatmapId,
        score: mapScore.score.toString(),
        accuracy: mapScore.accuracy,
        combo: mapScore.combo,
        passed: mapScore.passed,
        metRequirement: requirementEval.met,
        currentMapIndex: this.currentMapIndex,
        mapsCompleted: this.scores.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.warn('Failed to publish SCORE_UPDATE event', { error });
    }

    return { metRequirement: requirementEval.met, effectiveMisses, failed: requirementEval.failed };
  }

  private getTotalScore(): bigint {
    return this.scores.reduce((sum, s) => sum + s.score, BigInt(0));
  }

  /**
   * Finish the attempt
   * Called when all maps are completed or attempt is abandoned
   */
  private async finishAttempt(): Promise<void> {
    const { prisma } = await import('@/lib/core/prisma');
    const { deleteLobbyState } = await import('./recovery');

    this.stopHeartbeat();

    const totalMaps = this.config.maps.length;
    const mapsCompleted = this.scores.length;

    // Calculate total score
    const totalScore = this.getTotalScore();

    // Calculate average accuracy
    const avgAccuracy =
      this.scores.length > 0
        ? this.scores.reduce((sum, s) => sum + s.accuracy, 0) / this.scores.length
        : 0;

    // Two-tier clear calculation
    const allMapsCompleted = mapsCompleted === totalMaps;

    const isNormalPass =
      allMapsCompleted &&
      this.scores.every((s, index) => {
        const map = this.config.maps[index];
        const evalNormal = evaluateBeatmapRequirements(
          map,
          {
            score: s.score,
            accuracy: s.accuracy,
            combo: s.combo,
            countMiss: s.countMiss,
            effectiveMisses: s.effectiveMisses,
          },
          'normal',
        );
        return evalNormal.met;
      });

    const isGoldPass =
      allMapsCompleted &&
      this.scores.every((s, index) => {
        const map = this.config.maps[index];
        const evalGold = evaluateBeatmapRequirements(
          map,
          {
            score: s.score,
            accuracy: s.accuracy,
            combo: s.combo,
            countMiss: s.countMiss,
            effectiveMisses: s.effectiveMisses,
          },
          'gold',
        );
        return evalGold.met;
      });

    // Determine final status
    const status = allMapsCompleted ? 'COMPLETED' : 'ABANDONED';

    this.logger.info('Finishing attempt', {
      attemptId: this.config.attemptId,
      totalScore: totalScore.toString(),
      avgAccuracy,
      isNormalPass,
      isGoldPass,
      status,
    });

    // Update attempt in database
    await prisma.attempt.update({
      where: { id: this.config.attemptId },
      data: {
        status,
        totalScore,
        averageAccuracy: avgAccuracy,
        isNormalPass,
        isGoldPass,
        completedAt: new Date(),
      },
    });

    // Publish attempt completed event
    try {
      const { publishAttemptEvent } = await import('@/lib/core/redis');
      await publishAttemptEvent(this.config.attemptId, 'ATTEMPT_COMPLETED', {
        attemptId: this.config.attemptId,
        status,
        totalScore: totalScore.toString(),
        averageAccuracy: avgAccuracy,
        isNormalPass,
        isGoldPass,
        mapsCompleted,
        totalMaps,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.warn('Failed to publish ATTEMPT_COMPLETED event', { error });
    }

    // Clean up Redis state
    if (this.config.multiplayerId) {
      await deleteLobbyState(this.config.multiplayerId);
    }

    // Send completion message
    if (isGoldPass) {
      await this.lobby.channel.sendMessage(LOBBY_MESSAGES.goldClear(totalScore));
    } else if (isNormalPass) {
      await this.lobby.channel.sendMessage(LOBBY_MESSAGES.normalClear(totalScore));
    } else {
      await this.lobby.channel.sendMessage(
        LOBBY_MESSAGES.attemptFinished(mapsCompleted, totalMaps, totalScore),
      );
    }

    // Close lobby after 10 seconds
    setTimeout(async () => {
      await this.lobby.closeLobby();
    }, 10000);

    try {
      this.config.onDone?.();
    } catch (error) {
      this.logger.warn('onDone callback failed', { error });
    }
  }

  /**
   * Cleanup method for graceful shutdown
   * Closes the lobby and cleans up resources
   */
  async cleanup(): Promise<void> {
    try {
      // Publish abandonment event if still in progress
      try {
        const { publishAttemptEvent } = await import('@/lib/core/redis');
        await publishAttemptEvent(this.config.attemptId, 'ATTEMPT_FAILED', {
          attemptId: this.config.attemptId,
          reason: 'graceful_shutdown',
          currentMapIndex: this.currentMapIndex,
          mapsCompleted: this.scores.length,
          timestamp: Date.now(),
        });
      } catch (error) {
        this.logger.warn('Failed to publish graceful shutdown event', { error });
      }

      this.stopHeartbeat();
      await this.lobby.closeLobby();
      console.log(`[MultiplayerManager] Lobby closed for: ${this.config.danName}`);

      try {
        this.config.onDone?.();
      } catch (error) {
        this.logger.warn('onDone callback failed during cleanup', { error });
      }
    } catch (error) {
      console.error(`[MultiplayerManager] Failed to close lobby:`, error);
      throw error;
    }
  }
}
