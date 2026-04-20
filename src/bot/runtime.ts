import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import {
  BanchoClient,
  BanchoLobbyPlayerStates,
  BanchoLobbyWinConditions,
  ConnectStates,
  BanchoMods,
  type BanchoMod,
} from "bancho.js";
import { getDatabase, type AppDatabase } from "@/db/client";
import { getCourseByNameKey, storeCourseRunResult } from "@/db/queries";
import { DOJO_USAGE_LINE, parseDojoCommand } from "@/bot/command";
import { noopLogger, type BotLogFields, type BotLogger } from "@/bot/logger";
import {
  fetchLatestPlayerMapScore,
  type NormalizedPlayerMapScore,
} from "@/bot/osuApi";
import { totalHitObjects } from "@/lib/accuracy";
import { judgeCourseRun, judgeThreshold } from "@/lib/judging";
import { parseCourseMods, validateCourseMods } from "@/lib/mods";
import { formatConditionValue, kebabizeName } from "@/lib/format";
import type { CourseDefinition, JudgedMapResult } from "@/lib/domain";
import { sleep as defaultSleep } from "@/lib/sleep";

if (existsSync(".env")) {
  if (typeof loadEnvFile === "function") {
    loadEnvFile();
  } else {
    loadEnvFallback(".env");
  }
}

export interface BotUserLike {
  id?: number;
  username?: string;
  ircUsername: string;
  fetchFromAPI?: () => Promise<{ id: number; username?: string }>;
  sendMessage: (message: string) => Promise<null>;
}

export interface PrivateMessageLike {
  user: BotUserLike;
  message: string;
  self: boolean;
}

interface LobbyPlayerLike {
  user: BotUserLike;
  state: Symbol;
}

interface LobbyPlayerScoreLike {
  score: number;
  pass: boolean;
  player: LobbyPlayerLike;
}

interface LobbyChannelLike extends EventEmitter {
  sendMessage: (message: string) => Promise<null>;
}

interface LobbyChannelMessageLike {
  user: BotUserLike;
  message: string;
  self: boolean;
}

export interface LobbyLike extends EventEmitter {
  id: number;
  channel: LobbyChannelLike;
  fetchFromAPI: () => Promise<unknown>;
  getPlayerById: (id: number) => Promise<LobbyPlayerLike>;
  updateSettings: () => Promise<null>;
  lockSlots: () => Promise<null>;
  setMap: (mapId: number) => Promise<null>;
  setMods: (mods: string | BanchoMod[]) => Promise<null>;
  setSettings: (
    teamMode?: number,
    winCondition?: number,
    size?: number,
  ) => Promise<null>;
  startMatch: (timeout?: number) => Promise<null>;
  invitePlayer: (player: string) => Promise<null>;
  closeLobby: () => Promise<null>;
}

interface MultiplayerChannelLike {
  lobby: LobbyLike;
}

export interface BotClientLike extends EventEmitter {
  createLobby: (name: string, privateLobby?: boolean) => Promise<MultiplayerChannelLike>;
  connect?: () => Promise<null>;
  disconnect?: () => void;
}

type ActiveRunStatus =
  | "waiting_for_player"
  | "countdown"
  | "playing_map"
  | "resolving_map"
  | "between_maps"
  | "finalizing"
  | "aborted";

interface ActiveRun {
  runId: string;
  course: CourseDefinition;
  playerUserId: number;
  playerUsername: string;
  startedAt: number;
  lobby?: LobbyLike;
  currentBeatmapIndex: number;
  mapResults: Omit<JudgedMapResult, "id" | "runId">[];
  processedGameIds: Set<number>;
  status: ActiveRunStatus;
  lastProgressAt: number;
  inactivityTimer?: NodeJS.Timeout;
  countdownTimer?: NodeJS.Timeout;
  lobbyCloseTimer?: NodeJS.Timeout;
  startInFlight?: boolean;
  disposeListeners: Array<() => void>;
  targetPlayerFinishedCurrentMap: {
    score: number;
    pass: boolean;
    finishedAt: number;
  } | null;
  cleanupPromise?: Promise<void>;
  endEventEmitted?: boolean;
}

interface PreviousStartCommand {
  systemNameKey: string;
  courseNameKey: string;
}

interface PlayerIdentity {
  userId: number;
  username: string;
}

export interface CreateDojoBotOptions {
  client?: BotClientLike;
  db?: AppDatabase;
  logger?: BotLogger;
  sleep?: (milliseconds: number) => Promise<void>;
  fetchScore?: (
    lobby: LobbyLike,
    options: {
      beatmapId: number;
      userId: number;
      processedGameIds: Set<number>;
      attempts?: number;
      delayMs?: number;
    },
  ) => Promise<NormalizedPlayerMapScore>;
  restDurationMs?: number;
  firstMapCountdownSeconds?: number;
  inactivityTimeoutMs?: number;
  finalGracePeriodMs?: number;
  connectOnStart?: boolean;
}

export interface RunEndedEvent {
  runId: string;
  playerUserId: number;
  result: "completed" | "aborted";
  reason?: string;
}

const DEFAULT_REST_DURATION_MS = 20_000;
const DEFAULT_FIRST_MAP_COUNTDOWN_SECONDS = 10;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_FINAL_GRACE_PERIOD_MS = 60_000;
const STANDARD_SCORE_FETCH_ATTEMPTS = 4;
const STANDARD_SCORE_FETCH_DELAY_MS = 1_000;
const CONFIRMED_FINISH_SCORE_FETCH_ATTEMPTS = 15;
const CONFIRMED_FINISH_SCORE_FETCH_DELAY_MS = 3_000;
const CLOSE_LOBBY_TIMEOUT_MS = 5_000;
const START_CONFIRMATION_GRACE_MS = 2_000;
const TEAM_MODE_HEAD_TO_HEAD = 0;
const MATCH_INTERRUPTED_MESSAGE =
  "Run aborted: the match was interrupted before completion. Your attempt has ended. Start a new run when ready.";
const SCORE_RESOLUTION_TIMEOUT_MESSAGE =
  "Run aborted: you finished the map, but the osu! API did not publish the match result in time. Your attempt has ended. Start a new run when ready.";
const IRC_DISCONNECTED_MESSAGE =
  "Run aborted: the bot disconnected from Bancho. Start a new run when the connection is back.";
const MISSING_MAP_MESSAGE =
  "Run aborted: you do not have the map yet. Download it and start again.";
const INVALID_COMMAND_MESSAGE = "Invalid command. Use !dojo help for a guide.";
const NO_PREVIOUS_COMMAND_MESSAGE =
  "No previous command. Use !dojo start <system-name> <course-name> to begin.";

class SetupAbortedError extends Error {
  constructor() {
    super("Run aborted during setup.");
    this.name = "SetupAbortedError";
  }
}

export function createLiveBanchoClient() {
  return new BanchoClient({
    username: requiredEnv("OSU_IRC_USERNAME"),
    password: requiredEnv("OSU_IRC_PASSWORD"),
    apiKey: requiredEnv("OSU_API_KEY"),
  });
}

export function createDojoBot(options: CreateDojoBotOptions = {}) {
  const client = options.client ?? createLiveBanchoClient();
  const logger = options.logger ?? noopLogger;
  const sleep = options.sleep ?? defaultSleep;
  const fetchScore = options.fetchScore ?? fetchLatestPlayerMapScore;
  const events = new EventEmitter();
  const activeRunsByUserId = new Map<number, ActiveRun>();
  const activeRunsByLobbyId = new Map<number, ActiveRun>();
  const previousStartByUserId = new Map<number, PreviousStartCommand>();
  const runsPendingLobbyClose = new Set<ActiveRun>();
  const timings = {
    inactivityTimeoutMs:
      options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS,
    restDurationMs: options.restDurationMs ?? DEFAULT_REST_DURATION_MS,
    firstMapCountdownSeconds:
      options.firstMapCountdownSeconds ?? DEFAULT_FIRST_MAP_COUNTDOWN_SECONDS,
    finalGracePeriodMs:
      options.finalGracePeriodMs ?? DEFAULT_FINAL_GRACE_PERIOD_MS,
  };
  const runtimeState: {
    clientDisconnected: boolean;
    databasePromise?: Promise<AppDatabase>;
  } = {
    clientDisconnected: false,
  };

  function getRunLogFields(run: ActiveRun, fields?: BotLogFields): BotLogFields {
    return {
      runId: run.runId,
      userId: run.playerUserId,
      username: run.playerUsername,
      courseRoute: `${kebabizeName(run.course.danSystemName)}/${kebabizeName(
        run.course.name,
      )}`,
      ...fields,
    };
  }

  function safeSendUserMessage(user: BotUserLike, message: string) {
    return user.sendMessage(message).catch((error) => {
      logger.error("dojo user message failed", {
        error,
        ircUsername: user.ircUsername,
        userId: user.id,
      });
      return null;
    });
  }

  function safeSendLobbyMessage(lobby: LobbyLike, message: string) {
    return lobby.channel.sendMessage(message).catch((error) => {
      const run = activeRunsByLobbyId.get(lobby.id);
      logger.error(
        "dojo lobby message failed",
        run
          ? getRunLogFields(run, { error, lobbyId: lobby.id })
          : { error, lobbyId: lobby.id },
      );
      return null;
    });
  }

  type ManagedRunTimer = "countdownTimer" | "inactivityTimer" | "lobbyCloseTimer";

  function clearRunTimer(run: ActiveRun, timer: ManagedRunTimer) {
    const activeTimer = run[timer];
    if (!activeTimer) {
      return;
    }

    clearTimeout(activeTimer);
    run[timer] = undefined;
  }

  function scheduleRunTimer(
    run: ActiveRun,
    timer: ManagedRunTimer,
    milliseconds: number,
    callback: () => void,
  ) {
    clearRunTimer(run, timer);
    const activeTimer = setTimeout(callback, Math.max(0, milliseconds));
    activeTimer.unref?.();
    run[timer] = activeTimer;
  }

  function transitionRunStatus(run: ActiveRun, status: ActiveRunStatus) {
    if (status !== run.status) {
      run.startInFlight = false;
    }

    if (
      (run.status === "countdown" || run.status === "between_maps") &&
      status !== run.status
    ) {
      clearRunTimer(run, "countdownTimer");
    }
    run.status = status;
  }

  function isWaitingToStart(run: ActiveRun) {
    return run.status === "countdown" || run.status === "between_maps";
  }

  async function refreshTargetPlayerState(
    run: ActiveRun,
    warningMessage: string,
  ) {
    if (!run.lobby) {
      return null;
    }

    try {
      await run.lobby.updateSettings();
      const player = await run.lobby.getPlayerById(run.playerUserId);
      return player.state;
    } catch (error) {
      logger.warn(warningMessage, getRunLogFields(run, { error }));
      return null;
    }
  }

  function isTrackedRun(run: ActiveRun) {
    return activeRunsByUserId.get(run.playerUserId) === run;
  }

  function isActiveRun(run: ActiveRun) {
    return run.status !== "aborted" && isTrackedRun(run);
  }

  function emitRunEnded(run: ActiveRun, event: RunEndedEvent) {
    if (run.endEventEmitted) {
      return;
    }

    run.endEventEmitted = true;
    events.emit("runEnded", event);
  }

  function scheduleInactivityTimeout(run: ActiveRun) {
    clearRunTimer(run, "inactivityTimer");

    if (!isActiveRun(run)) {
      return;
    }

    scheduleRunTimer(run, "inactivityTimer", timings.inactivityTimeoutMs, () => {
      void abortRun(
        run,
        "inactivity-timeout",
        "Run aborted: the room was inactive for too long. Start again with !dojo start <system-name> <course-name>.",
      ).catch((error) => {
        logger.error("dojo inactivity abort failed", getRunLogFields(run, { error }));
      });
    });
  }

  function touchRunProgress(run: ActiveRun) {
    run.lastProgressAt = Date.now();
    scheduleInactivityTimeout(run);
  }

  const onClientDisconnected = (error?: Error) => {
    runtimeState.clientDisconnected = true;
    logger.warn("dojo client disconnected", { error });

    for (const run of [...activeRunsByUserId.values()]) {
      if (run.status === "aborted" || run.status === "finalizing") {
        continue;
      }

      void abortRun(run, "irc-disconnected", IRC_DISCONNECTED_MESSAGE).catch((abortError) => {
        logger.error("dojo disconnect abort failed", getRunLogFields(run, { error: abortError }));
      });
    }
  };

  const onClientState = (state: Symbol, error?: Error) => {
    runtimeState.clientDisconnected = state === ConnectStates.Disconnected;
    logger.info("dojo client state changed", {
      state: state.description ?? String(state),
      error,
    });
  };

  const onPrivateMessage = async (message: PrivateMessageLike) => {
    if (message.self) {
      return;
    }

    const command = parseDojoCommand(message.message);
    if (!command) {
      return;
    }

    if (command.type === "help") {
      await safeSendUserMessage(message.user, DOJO_USAGE_LINE);
      return;
    }

    if (command.type === "invalid") {
      await safeSendUserMessage(message.user, INVALID_COMMAND_MESSAGE);
      return;
    }

    if (command.type === "skip") {
      await safeSendUserMessage(
        message.user,
        "Use !dojo skip in the multiplayer lobby chat.",
      );
      return;
    }

    const playerIdentity = await resolvePlayerIdentity(message.user);

    if (command.type === "prev") {
      const previousStart = previousStartByUserId.get(playerIdentity.userId);
      if (!previousStart) {
        await safeSendUserMessage(message.user, NO_PREVIOUS_COMMAND_MESSAGE);
        return;
      }

      await handleStartCommand(message.user, playerIdentity, previousStart, {
        rememberStart: false,
      });
      return;
    }

    if (command.type === "start") {
      await handleStartCommand(message.user, playerIdentity, command, {
        rememberStart: true,
      });
      return;
    }

    const exhaustiveCommand: never = command;
    return exhaustiveCommand;
  };

  async function handleStartCommand(
    user: BotUserLike,
    playerIdentity: PlayerIdentity,
    command: PreviousStartCommand,
    optionsForStart: { rememberStart: boolean },
  ) {
    const database = await getDb();
    logger.info("dojo command received", {
      systemNameKey: command.systemNameKey,
      courseNameKey: command.courseNameKey,
      userId: playerIdentity.userId,
      username: playerIdentity.username,
    });
    const existingRun = activeRunsByUserId.get(playerIdentity.userId);
    if (
      existingRun &&
      (existingRun.status === "finalizing" || existingRun.status === "aborted")
    ) {
      await safeSendUserMessage(
        user,
        "Run is already finishing. Please try again in a moment.",
      );
      return;
    }

    const course = await getCourseByNameKey(
      command.systemNameKey,
      command.courseNameKey,
      database,
    );
    if (!course) {
      logger.warn("dojo unknown route", {
        systemNameKey: command.systemNameKey,
        courseNameKey: command.courseNameKey,
        userId: playerIdentity.userId,
        username: playerIdentity.username,
      });
      await safeSendUserMessage(
        user,
        `Unknown course "${command.systemNameKey} ${command.courseNameKey}".`,
      );
      return;
    }

    if (optionsForStart.rememberStart) {
      previousStartByUserId.set(playerIdentity.userId, {
        systemNameKey: command.systemNameKey,
        courseNameKey: command.courseNameKey,
      });
    }

    if (existingRun && activeRunsByUserId.get(playerIdentity.userId) === existingRun) {
      if (existingRun.status === "finalizing" || existingRun.status === "aborted") {
        await safeSendUserMessage(
          user,
          "Run is already finishing. Please try again in a moment.",
        );
        return;
      }

      logger.info("dojo superseding active run on new start", {
        userId: playerIdentity.userId,
        username: playerIdentity.username,
        existingCourse: `${kebabizeName(
          existingRun.course.danSystemName,
        )}/${kebabizeName(existingRun.course.name)}`,
        existingStatus: existingRun.status,
      });
      await abortRun(
        existingRun,
        "superseded-by-new-start",
        "Run aborted: starting a new course.",
        { closeDelayMs: 0 },
      );
      if (existingRun.cleanupPromise) {
        await existingRun.cleanupPromise;
      }
    }

    const run: ActiveRun = {
      runId: randomUUID(),
      course,
      playerUserId: playerIdentity.userId,
      playerUsername: playerIdentity.username,
      startedAt: Date.now(),
      currentBeatmapIndex: 0,
      mapResults: [],
      processedGameIds: new Set<number>(),
      status: "waiting_for_player",
      lastProgressAt: Date.now(),
      disposeListeners: [],
      targetPlayerFinishedCurrentMap: null,
    };

    activeRunsByUserId.set(run.playerUserId, run);
    logger.info("dojo run created", getRunLogFields(run, { startedAt: run.startedAt }));

    const isRunAbortedDuringSetup = () =>
      run.status === "aborted" || activeRunsByUserId.get(run.playerUserId) !== run;

    const closeAbortedSetupLobby = async () => {
      if (run.lobby) {
        await closeLobbyBestEffort(run);
      }
    };

    const checkAborted = async () => {
      if (!isRunAbortedDuringSetup()) {
        return;
      }

      await closeAbortedSetupLobby();
      throw new SetupAbortedError();
    };

    try {
      const lobbyTitle = getLobbyTitle(course);
      await safeSendUserMessage(
        user,
        `Creating multiplayer room ${lobbyTitle}. Download the maps before joining: ${getCoursePageUrl(course)}. Watch for an invite from BanchoBot.`,
      );

      const lobbyChannel = await client.createLobby(lobbyTitle);
      run.lobby = lobbyChannel.lobby;
      await checkAborted();
      activeRunsByLobbyId.set(run.lobby.id, run);

      await run.lobby.updateSettings();
      await checkAborted();
      await run.lobby.lockSlots();
      await checkAborted();
      attachLobbyListeners(run);
      await safeSendLobbyMessage(
        run.lobby,
        `Loaded ${course.name}. Waiting for ${run.playerUsername} to join.`,
      );
      await checkAborted();
      await run.lobby.invitePlayer(`#${run.playerUserId}`);
      await checkAborted();
      touchRunProgress(run);
      logger.info(
        "dojo lobby created and player invited",
        getRunLogFields(run, { lobbyId: run.lobby.id }),
      );

      await safeSendUserMessage(
        user,
        `Room ready: ${lobbyTitle}. Join the invite to begin.`,
      );
    } catch (error) {
      if (error instanceof SetupAbortedError) {
        return;
      }
      if (isRunAbortedDuringSetup()) {
        await closeAbortedSetupLobby();
        return;
      }

      logger.error("dojo room creation failed", getRunLogFields(run, { error }));
      await safeSendUserMessage(
        user,
        `Failed to create the multiplayer room: ${toErrorMessage(error)}`,
      );
      transitionRunStatus(run, "aborted");
      await releaseRun(run, "room-creation-failed");
      await closeLobbyBestEffort(run);
      emitRunEnded(run, {
        runId: run.runId,
        playerUserId: run.playerUserId,
        result: "aborted",
        reason: "room-creation-failed",
      });
    }
  }

  function attachLobbyListeners(run: ActiveRun) {
    if (!run.lobby) {
      return;
    }

    const handleLobbySkip = async (user: BotUserLike) => {
      let identity: PlayerIdentity;
      try {
        identity = await resolvePlayerIdentity(user);
      } catch (error) {
        logger.warn(
          "dojo lobby skip identity resolve failed",
          getRunLogFields(run, { error }),
        );
        return;
      }

      if (identity.userId !== run.playerUserId) {
        return;
      }
      if (!isActiveRun(run)) {
        return;
      }
      if (!isWaitingToStart(run) || run.startInFlight) {
        return;
      }

      await startMatchAfterCountdown(run);
    };

    const onLobbyChannelMessage = (msg: LobbyChannelMessageLike) => {
      if (msg.self) {
        return;
      }

      const command = parseDojoCommand(msg.message);
      if (!command || command.type !== "skip") {
        return;
      }

      void handleLobbySkip(msg.user).catch((error) => {
        logger.error(
          "dojo lobby skip handling failed",
          getRunLogFields(run, { error }),
        );
      });
    };

    const onPlayerJoined = async ({ player }: { player: LobbyPlayerLike }) => {
      if (run.status !== "waiting_for_player" || !isTargetPlayer(player.user, run)) {
        return;
      }

      touchRunProgress(run);
      logger.info("dojo target player joined", getRunLogFields(run));
      try {
        await prepareCurrentBeatmap(run, {
          announceStart: true,
          countdownSeconds: timings.firstMapCountdownSeconds,
        });
      } catch (error) {
        logger.error("dojo pre-match setup failed", getRunLogFields(run, { error }));
        await abortRun(run, "pre-match-setup-failed", `Run aborted: ${toErrorMessage(error)}`);
      }
    };

    const onMatchStarted = () => {
      if (!isWaitingToStart(run)) {
        return;
      }

      transitionRunStatus(run, "playing_map");
      touchRunProgress(run);
    };

    const onPlayerFinished = ({ score, pass, player }: LobbyPlayerScoreLike) => {
      if (!isActiveRun(run) || run.status !== "playing_map") {
        return;
      }

      if (!isTargetPlayer(player.user, run)) {
        return;
      }

      run.targetPlayerFinishedCurrentMap = {
        score,
        pass,
        finishedAt: Date.now(),
      };
      touchRunProgress(run);
      logger.info("dojo target player finished map", getRunLogFields(run));
    };

    const onPlayerLeft = async (player: LobbyPlayerLike) => {
      if (!isTargetPlayer(player.user, run)) {
        return;
      }

      if (
        run.status !== "waiting_for_player" &&
        run.status !== "countdown" &&
        run.status !== "playing_map" &&
        run.status !== "resolving_map" &&
        run.status !== "between_maps"
      ) {
        return;
      }

      logger.warn("dojo target player left lobby", getRunLogFields(run, { status: run.status }));
      await abortRun(run, "player-left", "Run aborted: player left the room.");
    };

    const onMatchFinished = async () => {
      if (run.status !== "playing_map") {
        return;
      }

      transitionRunStatus(run, "resolving_map");
      touchRunProgress(run);
      try {
        await handleMatchFinished(run);
      } catch (error) {
        logger.error("dojo match processing failed", getRunLogFields(run, { error }));
        await abortRun(run, "match-processing-failed", `Run aborted: ${toErrorMessage(error)}`);
      }
    };

    const onMatchAborted = async () => {
      if (run.status !== "playing_map") {
        return;
      }

      logger.warn("dojo match aborted during play", getRunLogFields(run));
      await abortRun(run, "match-aborted", MATCH_INTERRUPTED_MESSAGE);
    };

    run.lobby.channel.on("message", onLobbyChannelMessage);
    run.lobby.on("playerJoined", onPlayerJoined);
    run.lobby.on("matchStarted", onMatchStarted);
    run.lobby.on("playerFinished", onPlayerFinished);
    run.lobby.on("playerLeft", onPlayerLeft);
    run.lobby.on("matchFinished", onMatchFinished);
    run.lobby.on("matchAborted", onMatchAborted);
    run.disposeListeners.push(() =>
      run.lobby?.channel.removeListener("message", onLobbyChannelMessage),
    );
    run.disposeListeners.push(() => run.lobby?.removeListener("playerJoined", onPlayerJoined));
    run.disposeListeners.push(() => run.lobby?.removeListener("matchStarted", onMatchStarted));
    run.disposeListeners.push(() => run.lobby?.removeListener("playerFinished", onPlayerFinished));
    run.disposeListeners.push(() => run.lobby?.removeListener("playerLeft", onPlayerLeft));
    run.disposeListeners.push(() =>
      run.lobby?.removeListener("matchFinished", onMatchFinished),
    );
    run.disposeListeners.push(() =>
      run.lobby?.removeListener("matchAborted", onMatchAborted),
    );
  }

  async function handleMatchFinished(run: ActiveRun) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const beatmap = run.course.beatmaps[run.currentBeatmapIndex];
    const hasConfirmedFinish = run.targetPlayerFinishedCurrentMap !== null;
    const scoreFetchOptions = hasConfirmedFinish
      ? {
          attempts: CONFIRMED_FINISH_SCORE_FETCH_ATTEMPTS,
          delayMs: CONFIRMED_FINISH_SCORE_FETCH_DELAY_MS,
        }
      : {
          attempts: STANDARD_SCORE_FETCH_ATTEMPTS,
          delayMs: STANDARD_SCORE_FETCH_DELAY_MS,
        };
    let fetchedScore: NormalizedPlayerMapScore;

    try {
      fetchedScore = await fetchScore(run.lobby, {
        beatmapId: beatmap.beatmapId,
        userId: run.playerUserId,
        processedGameIds: run.processedGameIds,
        ...scoreFetchOptions,
      });
    } catch (error) {
      if (!isActiveRun(run)) {
        return;
      }

      if (isInterruptedScoreFetchError(error)) {
        if (hasConfirmedFinish) {
          logger.warn(
            "dojo score resolution timed out after confirmed player finish",
            getRunLogFields(run, { error, beatmapId: beatmap.beatmapId }),
          );
          await abortRun(
            run,
            "score-resolution-timeout",
            SCORE_RESOLUTION_TIMEOUT_MESSAGE,
          );
          return;
        }

        const playerState = await refreshTargetPlayerState(
          run,
          "dojo interrupted score state refresh failed",
        );
        if (playerState === BanchoLobbyPlayerStates.NoMap) {
          await abortRun(run, "missing-map", MISSING_MAP_MESSAGE);
          return;
        }

        logger.warn(
          "dojo interrupted run detected while resolving score",
          getRunLogFields(run, { error, beatmapId: beatmap.beatmapId }),
        );
        await abortRun(run, "match-interrupted", MATCH_INTERRUPTED_MESSAGE);
        return;
      }

      throw error;
    }

    if (!isActiveRun(run)) {
      return;
    }

    run.processedGameIds.add(fetchedScore.gameId);

    const playedObjects = totalHitObjects(fetchedScore);
    const isPartialPlay =
      beatmap.totalObjects !== null && playedObjects < beatmap.totalObjects;

    const threshold = judgeThreshold(beatmap.passConditionType, beatmap.passConditionThreshold, {
      accuracy: fetchedScore.accuracy,
      score: fetchedScore.score,
    });

    const judgedMapResult = {
      gameId: fetchedScore.gameId,
      beatmapId: beatmap.beatmapId,
      mods: ensureNoFailMods(beatmap.mods),
      passConditionType: beatmap.passConditionType,
      passConditionThreshold: beatmap.passConditionThreshold,
      ordinal: beatmap.ordinal,
      score: fetchedScore.score,
      accuracy: fetchedScore.accuracy,
      maxCombo: fetchedScore.maxCombo,
      count300: fetchedScore.count300,
      count100: fetchedScore.count100,
      count50: fetchedScore.count50,
      countMiss: fetchedScore.countMiss,
      passed: !isPartialPlay && threshold.passed,
      createdAt: Date.now(),
    } satisfies Omit<JudgedMapResult, "id" | "runId">;

    run.mapResults.push(judgedMapResult);

    if (isPartialPlay) {
      logger.warn(
        "dojo partial play detected",
        getRunLogFields(run, {
          beatmapId: beatmap.beatmapId,
          passed: false,
          playedObjects,
          expectedObjects: beatmap.totalObjects,
          thresholdPassed: threshold.passed,
        }),
      );
      await safeSendLobbyMessage(
        run.lobby,
        `Map ${beatmap.ordinal}: FAIL (partial play - ${playedObjects}/${beatmap.totalObjects} objects)`,
      );
    } else {
      logger.info(
        "dojo map judged",
        getRunLogFields(run, {
          beatmapId: beatmap.beatmapId,
          passed: threshold.passed,
          score: fetchedScore.score,
          accuracy: fetchedScore.accuracy,
          conditionType: threshold.type,
          value: threshold.value,
          threshold: threshold.threshold,
        }),
      );

      await safeSendLobbyMessage(
        run.lobby,
        `Map ${beatmap.ordinal}: ${threshold.passed ? "PASS" : "FAIL"} (${formatConditionValue(
          threshold.type,
          threshold.value,
        )} >= ${formatConditionValue(threshold.type, threshold.threshold)} required)`,
      );
    }

    if (!isActiveRun(run)) {
      return;
    }

    const isFinalMap = run.currentBeatmapIndex === run.course.beatmaps.length - 1;
    if (isFinalMap || !judgedMapResult.passed) {
      await finalizeRun(run);
      return;
    }

    run.currentBeatmapIndex += 1;
    await queueNextBeatmap(run);
  }

  async function queueNextBeatmap(run: ActiveRun) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const restDurationMs = timings.restDurationMs;
    const countdownSeconds = Math.max(0, Math.round(restDurationMs / 1000));
    await configureCurrentBeatmap(run, "between_maps");

    await safeSendLobbyMessage(run.lobby, `Next map in ${countdownSeconds}s.`);
    await sendLobbyTimer(run.lobby, countdownSeconds);

    touchRunProgress(run);
    queuePureStart(run, restDurationMs);
  }

  async function prepareCurrentBeatmap(
    run: ActiveRun,
    optionsForMap: { announceStart: boolean; countdownSeconds: number },
  ) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const beatmap = run.course.beatmaps[run.currentBeatmapIndex];
    await configureCurrentBeatmap(run, "countdown");

    if (optionsForMap.announceStart) {
      await safeSendLobbyMessage(
        run.lobby,
        `Map ${beatmap.ordinal}/${run.course.beatmaps.length}: beatmap ${beatmap.beatmapId} with ${ensureNoFailMods(
          beatmap.mods,
        )}. Starting in ${optionsForMap.countdownSeconds}s.`,
      );
    }
    await sendLobbyTimer(run.lobby, optionsForMap.countdownSeconds);

    touchRunProgress(run);
    queuePureStart(run, Math.max(0, optionsForMap.countdownSeconds) * 1000);
  }

  async function configureCurrentBeatmap(
    run: ActiveRun,
    status: "countdown" | "between_maps",
  ) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const beatmap = run.course.beatmaps[run.currentBeatmapIndex];

    run.targetPlayerFinishedCurrentMap = null;
    if (status === "countdown") {
      transitionRunStatus(run, "countdown");
    } else {
      transitionRunStatus(run, "between_maps");
    }
    await run.lobby.setMap(beatmap.beatmapId);
    await run.lobby.setMods(normalizeLobbyMods(beatmap.mods));
    await run.lobby.setSettings(
      TEAM_MODE_HEAD_TO_HEAD,
      getLobbyWinCondition(run.course.scoreModel),
      1,
    );
  }

  function sendLobbyTimer(lobby: LobbyLike, countdownSeconds: number) {
    if (countdownSeconds <= 0) {
      return Promise.resolve(null);
    }

    return safeSendLobbyMessage(lobby, `!mp timer ${countdownSeconds}`);
  }

  function queuePureStart(run: ActiveRun, countdownMs: number) {
    scheduleRunTimer(run, "countdownTimer", countdownMs, () => {
      void startMatchAfterCountdown(run).catch((error) => {
        logger.error("dojo local countdown start failed", getRunLogFields(run, { error }));
      });
    });
  }

  async function startMatchAfterCountdown(run: ActiveRun) {
    if (!isWaitingToStart(run) || !run.lobby || run.startInFlight) {
      return;
    }

    run.startInFlight = true;
    clearRunTimer(run, "countdownTimer");

    const playerState = await refreshTargetPlayerState(
      run,
      "dojo pre-start state refresh failed",
    );
    if (!isWaitingToStart(run) || !run.lobby) {
      return;
    }

    if (playerState === BanchoLobbyPlayerStates.NoMap) {
      await abortRun(run, "missing-map", MISSING_MAP_MESSAGE);
      return;
    }

    touchRunProgress(run);
    scheduleRunTimer(run, "countdownTimer", START_CONFIRMATION_GRACE_MS, () => {
      void abortQueuedCountdown(run).catch((error) => {
        logger.error(
          "dojo start confirmation watchdog failed",
          getRunLogFields(run, { error }),
        );
      });
    });

    void run.lobby.startMatch().catch((error) => {
      logger.warn("dojo pure start command failed", getRunLogFields(run, { error }));
      void abortQueuedCountdown(run).catch((abortError) => {
        logger.error(
          "dojo pure start rejection abort failed",
          getRunLogFields(run, { error: abortError }),
        );
      });
    });
  }

  async function closeLobbyBestEffort(run: ActiveRun): Promise<void> {
    if (!run.lobby || runtimeState.clientDisconnected) {
      return;
    }

    const closeResult = await Promise.race([
      run.lobby.closeLobby().then(
        () => ({ timedOut: false, error: null as Error | null }),
        (error: unknown) => ({
          timedOut: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      ),
      sleep(CLOSE_LOBBY_TIMEOUT_MS).then(() => ({
        timedOut: true,
        error: null as Error | null,
      })),
    ]);

    if (closeResult.timedOut) {
      logger.warn(
        "dojo lobby close timed out",
        getRunLogFields(run, { lobbyId: run.lobby.id }),
      );
      return;
    }

    if (closeResult.error) {
      logger.warn(
        "dojo lobby close failed",
        getRunLogFields(run, {
          error: closeResult.error,
          lobbyId: run.lobby.id,
        }),
      );
      return;
    }

    logger.info("dojo lobby closed", getRunLogFields(run, { lobbyId: run.lobby.id }));
  }

  async function abortQueuedCountdown(run: ActiveRun) {
    if (!isWaitingToStart(run) || !run.lobby) {
      return;
    }

    const abortReason =
      run.status === "between_maps" ? "next-map-start-failed" : "start-failed";
    let message =
      run.status === "between_maps"
        ? "Run aborted: the next map did not start after the 20s countdown."
        : "Run aborted: the match failed to start.";

    const playerState = await refreshTargetPlayerState(
      run,
      "dojo start abort state refresh failed",
    );
    if (playerState === BanchoLobbyPlayerStates.NoMap) {
      message = MISSING_MAP_MESSAGE;
    }

    await abortRun(run, abortReason, message);
  }

  function getRunFinalStatus(run: ActiveRun) {
    if (run.mapResults.length === 0) {
      return { passed: false, overall: null };
    }

    if (run.mapResults.length !== run.course.beatmaps.length) {
      return { passed: false, overall: null };
    }

    return judgeCourseRun(run.course, run.mapResults as JudgedMapResult[]);
  }

  function getLobbyClosingMessage(delayMs: number) {
    if (delayMs <= 0) {
      return null;
    }

    return `Lobby closing in ${Math.round(delayMs / 1000)}s.`;
  }

  interface PersistedRunPlan {
    passed: boolean;
    logMessage: string;
    logFields: BotLogFields;
    skipWhenNoMaps?: boolean;
  }

  interface RunTerminationPlan {
    transition: "aborted" | "finalizing";
    cleanupReason: string;
    event: RunEndedEvent;
    closeDelayMs?: number;
    beforePersistLobbyMessage?: string;
    afterPersistLobbyMessage?: string;
    persistedRun?: PersistedRunPlan;
  }

  async function releaseRun(run: ActiveRun, reason: string) {
    if (run.cleanupPromise) {
      await run.cleanupPromise;
      return;
    }

    run.cleanupPromise = (async () => {
      const hasTrackedState =
        activeRunsByUserId.get(run.playerUserId) === run ||
        (run.lobby ? activeRunsByLobbyId.get(run.lobby.id) === run : false) ||
        Boolean(run.inactivityTimer) ||
        Boolean(run.countdownTimer) ||
        run.disposeListeners.length > 0;

      if (!hasTrackedState) {
        return;
      }

      clearRunTimer(run, "inactivityTimer");
      clearRunTimer(run, "countdownTimer");

      for (const dispose of run.disposeListeners.splice(0)) {
        dispose();
      }

      activeRunsByUserId.delete(run.playerUserId);
      if (run.lobby) {
        activeRunsByLobbyId.delete(run.lobby.id);
      }

      logger.info(
        "dojo run cleaned up",
        getRunLogFields(run, {
          reason,
          lobbyId: run.lobby?.id,
        }),
      );
    })();

    await run.cleanupPromise;
  }

  function scheduleLobbyClose(run: ActiveRun, delayMs: number) {
    if (!run.lobby) {
      return;
    }

    clearRunTimer(run, "lobbyCloseTimer");
    runsPendingLobbyClose.add(run);
    scheduleRunTimer(run, "lobbyCloseTimer", delayMs, () => {
      run.lobbyCloseTimer = undefined;
      void closeReleasedLobby(run).catch((error) => {
        logger.warn("dojo delayed lobby close failed", getRunLogFields(run, { error }));
      });
    });
  }

  async function closeReleasedLobby(run: ActiveRun) {
    clearRunTimer(run, "lobbyCloseTimer");
    runsPendingLobbyClose.delete(run);
    await closeLobbyBestEffort(run);
  }

  async function persistRunResult(run: ActiveRun, plan: PersistedRunPlan) {
    if (plan.skipWhenNoMaps && run.mapResults.length === 0) {
      return;
    }

    await storeCourseRunResult(
      {
        userId: run.playerUserId,
        username: run.playerUsername,
        courseId: run.course.id,
        passed: plan.passed,
        startedAt: run.startedAt,
        completedAt: Date.now(),
        matchId: run.lobby?.id ?? null,
        maps: run.mapResults,
      },
      await getDb(),
    );

    logger.info(plan.logMessage, getRunLogFields(run, plan.logFields));
  }

  async function terminateRun(run: ActiveRun, plan: RunTerminationPlan) {
    if (plan.transition === "aborted" && run.status === "aborted") {
      return;
    }
    const closeDelayMs = plan.closeDelayMs ?? timings.finalGracePeriodMs;

    if (plan.transition === "aborted") {
      transitionRunStatus(run, "aborted");
    } else {
      transitionRunStatus(run, "finalizing");
    }

    if (plan.beforePersistLobbyMessage && run.lobby) {
      await safeSendLobbyMessage(run.lobby, plan.beforePersistLobbyMessage);
    }

    if (plan.persistedRun) {
      await persistRunResult(run, plan.persistedRun);
      if (plan.transition === "finalizing" && !isActiveRun(run)) {
        return;
      }
    }

    if (plan.afterPersistLobbyMessage && run.lobby) {
      await safeSendLobbyMessage(run.lobby, plan.afterPersistLobbyMessage);
    }

    if (run.lobby) {
      const closingMessage = getLobbyClosingMessage(closeDelayMs);
      if (closingMessage) {
        await safeSendLobbyMessage(run.lobby, closingMessage);
      }
    }

    await releaseRun(run, plan.cleanupReason);
    scheduleLobbyClose(run, closeDelayMs);
    emitRunEnded(run, plan.event);
  }

  function buildFinalRunLine(run: ActiveRun) {
    const judgedDan = getRunFinalStatus(run);
    const finalLine = judgedDan.overall
      ? `${judgedDan.passed ? "PASS" : "FAIL"} (${formatConditionValue(
          judgedDan.overall.type,
          judgedDan.overall.value,
        )} >= ${formatConditionValue(
          judgedDan.overall.type,
          judgedDan.overall.threshold,
        )} required)`
      : judgedDan.passed
        ? "PASS"
        : "FAIL";

    return {
      judgedDan,
      message: `${run.course.name}: ${finalLine}`,
    };
  }

  async function finalizeRun(run: ActiveRun) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    touchRunProgress(run);
    const finalResult = buildFinalRunLine(run);
    await terminateRun(run, {
      transition: "finalizing",
      cleanupReason: "finalized",
      event: {
        runId: run.runId,
        playerUserId: run.playerUserId,
        result: "completed",
      },
      afterPersistLobbyMessage: finalResult.message,
      persistedRun: {
        passed: finalResult.judgedDan.passed,
        logMessage: "dojo run result stored",
        logFields: {
          passed: finalResult.judgedDan.passed,
          mapCount: run.mapResults.length,
          lobbyId: run.lobby.id,
        },
      },
    });
  }

  async function abortRun(
    run: ActiveRun,
    reason: string,
    message: string,
    opts?: { closeDelayMs?: number },
  ) {
    await terminateRun(run, {
      transition: "aborted",
      cleanupReason: reason,
      closeDelayMs: opts?.closeDelayMs,
      event: {
        runId: run.runId,
        playerUserId: run.playerUserId,
        result: "aborted",
        reason,
      },
      beforePersistLobbyMessage: message,
      persistedRun: {
        passed: false,
        logMessage: "dojo interrupted run result stored",
        logFields: {
          reason,
          mapCount: run.mapResults.length,
          lobbyId: run.lobby?.id,
        },
        skipWhenNoMaps: true,
      },
    });
  }

  async function getDb() {
    if (!runtimeState.databasePromise) {
      runtimeState.databasePromise = options.db
        ? Promise.resolve(options.db)
        : getDatabase();
    }
    return runtimeState.databasePromise;
  }

  return {
    async start() {
      runtimeState.clientDisconnected = false;
      client.on("PM", onPrivateMessage);
      client.on("disconnected", onClientDisconnected);
      client.on("state", onClientState);
      if (options.connectOnStart ?? Boolean(client.connect)) {
        await connectWithTimeout(client);
      }
    },
    async stop() {
      client.removeListener("PM", onPrivateMessage);
      client.removeListener("disconnected", onClientDisconnected);
      client.removeListener("state", onClientState);

      const activeRuns = [...activeRunsByUserId.values()];
      for (const run of activeRuns) {
        transitionRunStatus(run, "aborted");
      }

      await Promise.all(activeRuns.map((run) => releaseRun(run, "stopped")));
      await Promise.all([...runsPendingLobbyClose].map((run) => closeReleasedLobby(run)));
      await Promise.all(activeRuns.map((run) => closeLobbyBestEffort(run)));
      runtimeState.clientDisconnected = true;
      client.disconnect?.();
    },
    handlePrivateMessage: onPrivateMessage,
    activeRunsByUserId,
    activeRunsByLobbyId,
    events,
  };
}

function getLobbyWinCondition(scoreModel: CourseDefinition["scoreModel"]) {
  return scoreModel === "scorev1"
    ? BanchoLobbyWinConditions.Score
    : BanchoLobbyWinConditions.ScoreV2;
}

function normalizeLobbyMods(mods: string) {
  return BanchoMods.parseShortMods(
    ensureNoFailModTokens(parseCourseMods(validateCourseMods(mods))),
  );
}

function ensureNoFailMods(mods: string) {
  const compact = mods.toUpperCase().replace(/\s+/g, "");
  return compact.includes("NF") ? compact : `${compact}NF`;
}

function ensureNoFailModTokens(mods: string[]) {
  return mods.includes("NF") ? mods : [...mods, "NF"];
}

async function resolvePlayerIdentity(user: BotUserLike): Promise<PlayerIdentity> {
  if (typeof user.id === "number") {
    return {
      userId: user.id,
      username: user.username ?? user.ircUsername,
    };
  }

  const apiUser = await user.fetchFromAPI?.();
  const userId = apiUser?.id ?? user.id;

  if (typeof userId !== "number") {
    throw new Error(
      "Unable to resolve the osu! user id for this DM sender. The bot requires API-backed user lookups.",
    );
  }

  return {
    userId,
    username: apiUser?.username ?? user.username ?? user.ircUsername,
  };
}

function isTargetPlayer(user: BotUserLike, run: ActiveRun) {
  return (
    user.id === run.playerUserId ||
    user.username === run.playerUsername ||
    user.ircUsername === run.playerUsername
  );
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getCoursePageUrl(course: CourseDefinition) {
  const baseUrl = (process.env.DOJO_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${baseUrl}/dan/${encodeURIComponent(
    kebabizeName(course.danSystemName),
  )}?course=${encodeURIComponent(kebabizeName(course.name))}`;
}

function getLobbyTitle(course: CourseDefinition) {
  return `osu!dojo: ${course.danSystemName} / ${course.name}`;
}

function loadEnvFallback(filePath: string) {
  const envFile = readFileSync(filePath, "utf8");

  for (const rawLine of envFile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const CONNECT_TIMEOUT_MS = 15_000;

export function connectWithTimeout(
  client: BotClientLike,
  timeoutMs = CONNECT_TIMEOUT_MS,
) {
  return Promise.race([
    client.connect!(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Connection to Bancho timed out after ${timeoutMs / 1000}s. Check that port 6667 is not blocked by your network.`,
            ),
          ),
        timeoutMs,
      ),
    ),
  ]);
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isInterruptedScoreFetchError(error: unknown) {
  const message = toErrorMessage(error);

  return (
    /^No completed multiplayer game found for beatmap \d+\.$/.test(message) ||
    /^Match \d+ does not include a score for user \d+\.$/.test(message)
  );
}
