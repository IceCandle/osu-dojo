import BanchoJs from "bancho.js";
import { createLogger } from '@/lib/logger';

// Type definitions for bancho.js events (library has incomplete TypeScript types)
interface MatchScore {
  player: {
    user: {
      username: string;
      id: number;
    };
  };
  score: number;
  pass: boolean;
  accuracy: number;
  maxCombo: number;
  count300?: number;
  count100?: number;
  count50?: number;
  countMiss?: number;
}

interface MapConfig {
  id: number; // Beatmap.id (DB primary key)
  beatmapId: number; // osu! beatmap ID
  mods: string[]; // e.g., ["HD", "HR"]
  name?: string; // Display name for the map
  requiredScore: bigint; // Normal clear (pass) requirement
  goldClearScore: bigint; // Gold clear requirement
  skillFocus?: string; // e.g., "Jump", "Stream", "Tech", "Reading"
  gameMode?: string; // OSU, TAIKO, CATCH, MANIA
}

interface AttemptConfig {
  attemptId: number; // Database attempt ID
  multiplayerId: string | null; // osu! multiplayer match ID
  username: string;
  danName: string;
  maps: MapConfig[]; // Final map list AFTER bans and candidate selection
  startMapIndex?: number; // 0-based map index for crash recovery
  onDone?: () => void;
}

interface MapScore {
  beatmapId: number; // Beatmap.id (DB primary key)
  score: bigint;
  passed: boolean;
  accuracy: number;
  combo: number;
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  metRequirement: boolean;
}

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
    // bancho.js ships incomplete TypeScript event typings for BanchoLobby.
    // Use a narrow `any` escape hatch for event names while keeping handler args typed.
    type OnLobby = <TArgs extends unknown[]>(
      event: string,
      listener: (...args: TArgs) => void
    ) => void;

    const onLobby = (this.lobby as unknown as { on: OnLobby }).on.bind(this.lobby) as OnLobby;

    // Player joined event
    onLobby("playerJoined", async (obj: { player: { user: { username: string } } }) => {
      const joinedUsername = obj.player.user.username;
      console.log(`Player joined: ${joinedUsername}`);

      if (joinedUsername === this.config.username) {
        this.playerJoined = true;
        await this.onPlayerReady();
      }
    });

    // Match finished event - automatic progression to next map
    onLobby("matchFinished", async (scores: MatchScore[]) => {
      await this.onMatchFinished(scores);
    });

    // Player left event
    onLobby("playerLeft", (obj: { user: { username: string } }) => {
      const leftUsername = obj.user.username;
      console.log(`Player left: ${leftUsername}`);

      if (leftUsername === this.config.username) {
        console.log("Target player left. Aborting attempt.");
        // TODO: Handle player disconnect gracefully
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
    setTimeout(() => {
      if (!this.playerJoined) {
        console.log("Player did not join in time. Closing lobby.");
        this.lobby.closeLobby();
      }
    }, 5 * 60 * 1000);
  }

  private async onPlayerReady(): Promise<void> {
    console.log("Player is ready. Starting attempt flow.");

    // Maps have already been selected and bans handled in processAttempt
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
      const { prisma } = await import('@/lib/prisma');
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
    console.log(`Playing map ${this.currentMapIndex + 1}/${this.config.maps.length}: ${map.beatmapId}`);

    // Set beatmap
    await this.lobby.setMap(map.beatmapId);

    // Set mods
    if (map.mods.length > 0) {
      await this.lobby.setMods(map.mods.join(""), false); // false = not freemod
    }

    // Start match immediately (minimal rest time as requested)
    await this.lobby.startMatch(5); // 5 second countdown
  }

  private async onMatchFinished(scores: MatchScore[]): Promise<void> {
    this.logger.info('Match finished, processing scores');

    // Find the player's score
    const playerScore = scores.find(
      (s) => s.player.user.username === this.config.username
    );

    if (playerScore) {
      const currentMap = this.config.maps[this.currentMapIndex];
      const score = BigInt(playerScore.score);
      const metRequirement = score >= currentMap.requiredScore;

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
        metRequirement,
      };

      this.scores.push(mapScore);

      this.logger.info('Score recorded', {
        beatmapId: currentMap.beatmapId,
        score: score.toString(),
        passed: mapScore.passed,
        metRequirement,
      });

      // Save score to database
      await this.saveScoreToDatabase(mapScore);

      // Check if player failed the map OR didn't meet score requirement
      if (!mapScore.passed || !metRequirement) {
        const failReason = !mapScore.passed
          ? "Map failed (did not complete)"
          : `Score too low (${score} < ${currentMap.requiredScore})`;

        const mapName = currentMap.name || `Map ${this.currentMapIndex + 1}`;
        const skillInfo = currentMap.skillFocus ? ` [${currentMap.skillFocus}]` : "";

        await this.lobby.channel.sendMessage(
          `${mapName}${skillInfo}: ${failReason}. Attempt ended.`
        );
        await this.finishAttempt();
        return;
      }

      // Passed this map! Show feedback
      await this.lobby.channel.sendMessage(
        `Map ${this.currentMapIndex + 1}/${this.config.maps.length} cleared! Score: ${score}`
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
  private async saveScoreToDatabase(mapScore: MapScore): Promise<void> {
    const { prisma } = await import('@/lib/prisma');
    const { redis } = await import('@/lib/redis');

    let sliderbreaks = 0;
    let effectiveMisses = mapScore.countMiss;

    // Try to get sliderbreak data from overlay
    const beatmap = this.config.maps.find(m => m.id === mapScore.beatmapId);

    if (beatmap?.gameMode === 'OSU') {
      const liveStatsKey = `attempt:${this.config.attemptId}:live-stats:${beatmap.beatmapId}`;
      const liveStatsData = await redis.get(liveStatsKey);

      if (liveStatsData) {
        const liveStats = JSON.parse(liveStatsData);
        sliderbreaks = liveStats.sliderbreaks || 0;
        effectiveMisses = mapScore.countMiss + sliderbreaks;

        this.logger.info('Sliderbreak data retrieved from overlay', {
          beatmapId: beatmap.beatmapId,
          sliderbreaks,
          effectiveMisses,
        });

        // Clean up after reading
        await redis.del(liveStatsKey);
      } else {
        this.logger.warn('No sliderbreak data from overlay - defaulting to 0', {
          beatmapId: beatmap.beatmapId,
          note: 'Player may not be using overlay, or tosu not running',
        });
      }
    }

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
        passed: mapScore.passed,
        metRequirement: mapScore.metRequirement,
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
  }

  private getTotalScore(): bigint {
    return this.scores.reduce((sum, s) => sum + s.score, BigInt(0));
  }

  /**
   * Finish the attempt
   * Called when all maps are completed or attempt is abandoned
   */
  private async finishAttempt(): Promise<void> {
    const { prisma } = await import('@/lib/prisma');
    const { deleteLobbyState } = await import('./recovery');

    this.stopHeartbeat();

    const totalMaps = this.config.maps.length;
    const mapsCompleted = this.scores.length;

    // Calculate total score
    const totalScore = this.getTotalScore();

    // Calculate average accuracy
    const avgAccuracy = this.scores.length > 0
      ? this.scores.reduce((sum, s) => sum + s.accuracy, 0) / this.scores.length
      : 0;

    // Two-tier clear calculation
    const allMapsCompleted = mapsCompleted === totalMaps;

    // Check if all maps met requiredScore (Normal Pass)
    const isNormalPass = allMapsCompleted &&
      this.scores.every(s => s.metRequirement);

    // Check if all maps met goldClearScore (Gold Pass)
    const isGoldPass = allMapsCompleted &&
      this.scores.every((s, index) => {
        const map = this.config.maps[index];
        return s.score >= map.goldClearScore;
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

    // Clean up Redis state
    if (this.config.multiplayerId) {
      await deleteLobbyState(this.config.multiplayerId);
    }

    // Send completion message
    if (isGoldPass) {
      await this.lobby.channel.sendMessage(
        `🏆 GOLD CLEAR! All maps cleared with gold requirements. Total: ${totalScore}`
      );
    } else if (isNormalPass) {
      await this.lobby.channel.sendMessage(
        `🎉 NORMAL CLEAR! All maps passed. Total: ${totalScore}`
      );
    } else {
      await this.lobby.channel.sendMessage(
        `Attempt finished. Completed ${mapsCompleted}/${totalMaps} maps. Total: ${totalScore}`
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
