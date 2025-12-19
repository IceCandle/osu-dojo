import BanchoJs from 'bancho.js';
import { createLogger } from '@/lib/core/logger';
import type { MatchScore } from '@/types/bancho-overrides';
import type { AttemptConfig, MapScore } from '@/types/bot-types';
import { LOBBY_MESSAGES } from '@/bot/messages';
import { formatRequirementFailures } from '@/lib/beatmap-requirements';
import { scoringService } from '@/lib/services/ScoringService';
import { EventPublisherService } from '../services/EventPublisherService';
import { HeartbeatService } from '../services/HeartbeatService';
import { LobbyProgressService } from '../services/LobbyProgressService';
import { ScoreProcessorService } from '../services/ScoreProcessorService';
import { AttemptLifecycleService } from '../services/AttemptLifecycleService';

/**
 * Manages a single dan attempt in a multiplayer room
 *
 * Orchestrates services to handle lobby lifecycle:
 * - EventPublisherService: Redis Pub/Sub events
 * - HeartbeatService: Periodic health checks
 * - LobbyProgressService: Progress syncing to Redis and database
 * - ScoreProcessorService: Score evaluation and persistence
 * - AttemptLifecycleService: Completion calculation
 */
export class MultiplayerManager {
  private lobby: BanchoJs.BanchoLobby;
  private config: AttemptConfig;
  private currentMapIndex: number = 0;
  private scores: MapScore[] = [];
  private playerJoined: boolean = false;
  private logger = createLogger('MultiplayerManager');

  // Services (injected via constructor for testability)
  private eventPublisher: EventPublisherService;
  private heartbeat: HeartbeatService;
  private progressSync: LobbyProgressService;
  private scoreProcessor: ScoreProcessorService;
  private attemptLifecycle: AttemptLifecycleService;

  constructor(
    lobby: BanchoJs.BanchoLobby,
    config: AttemptConfig,
    services?: {
      eventPublisher?: EventPublisherService;
      heartbeat?: HeartbeatService;
      progressSync?: LobbyProgressService;
      scoreProcessor?: ScoreProcessorService;
      attemptLifecycle?: AttemptLifecycleService;
    },
  ) {
    this.lobby = lobby;
    this.config = config;

    // Initialize services (use provided or create new instances)
    this.eventPublisher = services?.eventPublisher ?? new EventPublisherService();
    this.heartbeat = services?.heartbeat ?? new HeartbeatService();
    this.progressSync = services?.progressSync ?? new LobbyProgressService();
    this.scoreProcessor = services?.scoreProcessor ?? new ScoreProcessorService();
    this.attemptLifecycle = services?.attemptLifecycle ?? new AttemptLifecycleService();

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

        // Publish disconnect event
        await this.eventPublisher.publishAttemptFailed(this.config.attemptId, {
          reason: 'player_disconnected',
          currentMapIndex: this.currentMapIndex,
          mapsCompleted: this.scores.length,
        });

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

    // Start heartbeat
    if (this.config.multiplayerId) {
      this.heartbeat.start(this.config.multiplayerId);
    }

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

  private async playNextMap(): Promise<void> {
    if (this.currentMapIndex >= this.config.maps.length) {
      await this.finishAttempt();
      return;
    }

    // Sync progress to Redis and database
    await this.progressSync.syncProgress(
      this.config.attemptId,
      this.config.multiplayerId,
      this.currentMapIndex,
      this.scores.length,
    );

    const map = this.config.maps[this.currentMapIndex];
    console.log(
      `Playing map ${this.currentMapIndex + 1}/${this.config.maps.length}: ${map.beatmapId}`,
    );

    // ATTEMPT_STARTED semantics: publish exactly when the first map begins
    if (this.currentMapIndex === 0) {
      await this.eventPublisher.publishAttemptStarted(this.config.attemptId, {
        multiplayerId: this.config.multiplayerId,
        username: this.config.username,
        danName: this.config.danName,
        beatmapId: map.beatmapId,
      });
    }

    // Publish map changed event
    await this.eventPublisher.publishMapChanged(this.config.attemptId, {
      currentMapIndex: this.currentMapIndex,
      totalMaps: this.config.maps.length,
      beatmapId: map.beatmapId,
      beatmapName: map.name || `Map ${this.currentMapIndex + 1}`,
      mods: map.mods,
      requiredScore: map.requiredScore,
      goldClearScore: map.goldClearScore,
      skillFocus: map.skillFocus ?? null,
      gameMode: map.gameMode ?? 'OSU',
    });

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
        metRequirement: true, // computed by ScoreProcessorService
      };

      // Dans use ScoreV2 as the standard scoring system.
      // Store accuracy as the scoring-accuracy for the map's scoring system when we can.
      const gameMode = (currentMap.gameMode ?? 'OSU').toUpperCase();
      if (gameMode === 'OSU') {
        const scoringSystem = currentMap.scoringSystem ?? 'SCORE_V2';
        const accDecimal =
          scoringSystem === 'LAZER'
            ? scoringService.calculateLazerScoringAccuracy(
                mapScore.count300,
                mapScore.count100,
                mapScore.count50,
                mapScore.countMiss,
              )
            : scoringService.calculateScoreV2ScoringAccuracy(
                mapScore.count300,
                mapScore.count100,
                mapScore.count50,
                mapScore.countMiss,
              );

        mapScore.accuracy = accDecimal * 100;
      }

      // Process and save score
      const persisted = await this.scoreProcessor.processAndSaveScore(
        this.config.attemptId,
        mapScore,
        currentMap,
      );
      mapScore.metRequirement = persisted.metRequirement;
      mapScore.effectiveMisses = persisted.effectiveMisses;

      // Publish score update event
      await this.eventPublisher.publishScoreUpdate(this.config.attemptId, {
        beatmapId: mapScore.beatmapId,
        score: mapScore.score,
        accuracy: mapScore.accuracy,
        combo: mapScore.combo,
        passed: mapScore.passed,
        metRequirement: mapScore.metRequirement,
        currentMapIndex: this.currentMapIndex,
        mapsCompleted: this.scores.length,
      });

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
        await this.eventPublisher.publishAttemptFailed(this.config.attemptId, {
          reason: 'did_not_complete',
          failedAtMapIndex: this.currentMapIndex,
          totalMaps: this.config.maps.length,
          score: score,
          requiredScore: currentMap.requiredScore,
        });

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
          LOBBY_MESSAGES.mapRequirementMissed(
            mapName,
            currentMap.skillFocus ?? undefined,
            warnReason,
          ),
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
    await this.progressSync.syncProgress(
      this.config.attemptId,
      this.config.multiplayerId,
      this.currentMapIndex,
      this.scores.length,
    );
    await this.playNextMap();
  }

  /**
   * Finish the attempt
   * Called when all maps are completed or attempt is abandoned
   */
  private async finishAttempt(): Promise<void> {
    // Stop heartbeat
    this.heartbeat.stop();

    // Complete attempt and calculate results
    const result = await this.attemptLifecycle.completeAttempt(
      this.config.attemptId,
      this.config.multiplayerId,
      this.scores,
      this.config.maps,
    );

    this.logger.info('Attempt finished', {
      attemptId: this.config.attemptId,
      status: result.status,
      isNormalPass: result.isNormalPass,
      isGoldPass: result.isGoldPass,
    });

    // Publish attempt completed event
    await this.eventPublisher.publishAttemptCompleted(this.config.attemptId, {
      status: result.status,
      totalScore: result.totalScore,
      averageAccuracy: result.averageAccuracy,
      isNormalPass: result.isNormalPass,
      isGoldPass: result.isGoldPass,
      mapsCompleted: result.mapsCompleted,
      totalMaps: result.totalMaps,
    });

    // Send completion message
    if (result.isGoldPass) {
      await this.lobby.channel.sendMessage(LOBBY_MESSAGES.goldClear(result.totalScore));
    } else if (result.isNormalPass) {
      await this.lobby.channel.sendMessage(LOBBY_MESSAGES.normalClear(result.totalScore));
    } else {
      await this.lobby.channel.sendMessage(
        LOBBY_MESSAGES.attemptFinished(result.mapsCompleted, result.totalMaps, result.totalScore),
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
      await this.eventPublisher.publishAttemptFailed(this.config.attemptId, {
        reason: 'graceful_shutdown',
        currentMapIndex: this.currentMapIndex,
        mapsCompleted: this.scores.length,
      });

      this.heartbeat.stop();
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
