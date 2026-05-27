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
import {
  getDanSystemDetailByNameKey,
  listOpenLobbies,
  recordOpenLobby,
  removeOpenLobby,
  storeCourseRunResult,
} from "@/db/queries";
import { DOJO_USAGE_LINE, parseDojoCommand } from "@/bot/command";
import { noopLogger, type BotLogFields, type BotLogger } from "@/bot/logger";
import {
  createRunRegistry,
  type ActiveRun,
  type ActiveRunStatus,
} from "@/bot/runRegistry";
import {
  type FetchScoreOptions,
  fetchMatchText,
  fetchLatestPlayerMapScore,
  NoGameInApiError,
  NoPlayerScoreInGameError,
  type NormalizedPlayerMapScore,
  ScoreApiTimeoutError,
} from "@/bot/osuApi";
import { totalHitObjects } from "@/lib/accuracy";
import {
  assessCoursePassability,
  evaluateMapConditions,
  judgeCourseRun,
  type CourseImpossibilityReason,
  type JudgedThreshold,
} from "@/lib/judging";
import {
  formatModsCanonical,
  formatVisibleCourseMods,
  parseCourseMods,
  parseModBitmask,
  validateCourseMods,
  validateFreemodPlayerSelection,
} from "@/lib/mods";
import { buildPreMapGuidance } from "@/lib/preMapGuidance";
import {
  formatConditionValue,
  formatInteger,
  formatPercentage,
  kebabizeName,
} from "@/lib/format";
import { computeAdjustedScore, rawTargetForAdjustedRemaining } from "@/lib/score";
import { systemCapabilities } from "@/lib/domain";
import type { CourseDefinition, DanSystemDefinition, JudgedMapResult } from "@/lib/domain";
import { sleep as defaultSleep } from "@/lib/sleep";

export type { ActiveRun } from "@/bot/runRegistry";

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
  setMods: (mods: string | BanchoMod[], freemod?: boolean) => Promise<null>;
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

export interface BanchoChannelLike {
  join: () => Promise<unknown>;
  leave: () => Promise<unknown>;
  sendMessage: (message: string) => Promise<unknown>;
  lobby?: { closeLobby: () => Promise<unknown> };
}

export interface BotClientLike extends EventEmitter {
  createLobby: (name: string, privateLobby?: boolean) => Promise<MultiplayerChannelLike>;
  getChannel?: (name: string) => BanchoChannelLike | undefined;
  connect?: () => Promise<null>;
  disconnect?: () => void;
}

interface PreviousStartCommand {
  systemNameKey: string;
  courseNameKey: string;
}

interface PlayerIdentity {
  userId: number;
  username: string;
}

type FetchScore = (
  options: Omit<FetchScoreOptions, "fetchMatch"> & { lobbyId: number },
) => Promise<NormalizedPlayerMapScore>;

export interface CreateDojoBotOptions {
  client?: BotClientLike;
  db?: AppDatabase;
  logger?: BotLogger;
  sleep?: (milliseconds: number) => Promise<void>;
  fetchScore?: FetchScore;
  restDurationMs?: number;
  firstMapCountdownSeconds?: number;
  inactivityTimeoutMs?: number;
  finalGracePeriodMs?: number;
  connectOnStart?: boolean;
}

export type RunEndedReason =
  | "room-creation-failed"
  | "pre-match-setup-failed"
  | "superseded-by-new-start"
  | "player-left"
  | "match-aborted"
  | "match-interrupted"
  | "missing-map"
  | "irc-disconnected"
  | "inactivity-timeout"
  | "start-failed"
  | "next-map-start-failed"
  | "score-not-found"
  | "score-not-yet-published"
  | "score-api-timeout"
  | "match-processing-failed";

export type RunEndedEvent =
  | { runId: string; playerUserId: number; result: "completed" }
  | {
      runId: string;
      playerUserId: number;
      result: "aborted";
      reason: RunEndedReason;
    };

const DEFAULT_REST_DURATION_MS = 60_000;
const DEFAULT_FIRST_MAP_COUNTDOWN_SECONDS = 120;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_FINAL_GRACE_PERIOD_MS = 60_000;
const STANDARD_SCORE_FETCH_TOTAL_BUDGET_MS = 4_000;
const STANDARD_SCORE_FETCH_CALL_TIMEOUT_MS = 3_000;
const STANDARD_SCORE_FETCH_RETRY_DELAY_MS = 1_000;
const CONFIRMED_FINISH_SCORE_FETCH_TOTAL_BUDGET_MS = 45_000;
const CONFIRMED_FINISH_SCORE_FETCH_CALL_TIMEOUT_MS = 4_000;
const CONFIRMED_FINISH_SCORE_FETCH_RETRY_DELAY_MS = 2_500;
const PARTIAL_PLAY_REFETCH_DELAY_MS = 2_500;
const CLOSE_LOBBY_TIMEOUT_MS = 5_000;
const START_CONFIRMATION_GRACE_MS = 2_000;
const TEAM_MODE_HEAD_TO_HEAD = 0;
const MATCH_INTERRUPTED_MESSAGE =
  "Run aborted: the match was interrupted before completion. Your attempt has ended. Start a new run when ready.";
const SCORE_NOT_YET_PUBLISHED_MESSAGE =
  "Run aborted: you finished the map, but the osu! API did not publish the match result in time. Your attempt has ended. Start a new run when ready.";
const SCORE_NOT_FOUND_MESSAGE =
  "Run aborted: no score was recorded for you on this map.";
const SCORE_API_TIMEOUT_MESSAGE =
  "Run aborted: the osu! API did not respond. Try again shortly.";
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

export function createLiveBotDependencies(): {
  client: BanchoClient;
  fetchScore: FetchScore;
} {
  const apiKey = requiredEnv("OSU_API_KEY");
  const client = new BanchoClient({
    username: requiredEnv("OSU_IRC_USERNAME"),
    password: requiredEnv("OSU_IRC_PASSWORD"),
    apiKey,
  });

  return {
    client,
    fetchScore: createLiveFetchScore(apiKey),
  };
}

function createLiveFetchScore(apiKey: string): FetchScore {
  return (options) =>
    fetchLatestPlayerMapScore({
      ...options,
      fetchMatch: (signal) => fetchMatchText(apiKey, options.lobbyId, signal),
    });
}

function createLazyLiveFetchScore(): FetchScore {
  let fetchScore: FetchScore | undefined;

  return (options) => {
    fetchScore ??= createLiveFetchScore(requiredEnv("OSU_API_KEY"));
    return fetchScore(options);
  };
}

export function createDojoBot(options: CreateDojoBotOptions = {}) {
  let liveDependencies: ReturnType<typeof createLiveBotDependencies> | undefined;
  const getLiveDependencies = () => {
    liveDependencies ??= createLiveBotDependencies();
    return liveDependencies;
  };
  const client = options.client ?? getLiveDependencies().client;
  const logger = options.logger ?? noopLogger;
  const sleep = options.sleep ?? defaultSleep;
  const fetchScore =
    options.fetchScore ??
    (options.client ? createLazyLiveFetchScore() : getLiveDependencies().fetchScore);
  const events = new EventEmitter();
  const runRegistry = createRunRegistry();
  const activeRunsByUserId = runRegistry.byUserId;
  const activeRunsByLobbyId = runRegistry.byLobbyId;
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

  function logUnknownModTokens(
    run: ActiveRun,
    beatmapId: number,
    tokens: string[],
  ) {
    const unknown = tokens.filter((token) => token.startsWith("UNKNOWN:"));
    if (unknown.length === 0) {
      return;
    }

    logger.warn(
      "dojo unknown mod bitmask token",
      getRunLogFields(run, {
        beatmapId,
        unknownMods: unknown,
      }),
    );
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

  function safeSendLobbyMessage(lobby: LobbyLike, message: string): Promise<boolean> {
    return lobby.channel.sendMessage(message).then(
      () => true,
      (error) => {
        const run = activeRunsByLobbyId.get(lobby.id);
        logger.error(
          "dojo lobby message failed",
          run
            ? getRunLogFields(run, { error, lobbyId: lobby.id })
            : { error, lobbyId: lobby.id },
        );
        return false;
      },
    );
  }

  async function recordOpenLobbyForRun(run: ActiveRun) {
    if (!run.lobby) {
      return;
    }

    try {
      await recordOpenLobby(
        {
          matchId: run.lobby.id,
          userId: run.playerUserId,
          courseId: run.course.id,
        },
        await getDb(),
      );
    } catch (error) {
      logger.warn(
        "dojo open lobby record failed",
        getRunLogFields(run, { error, lobbyId: run.lobby.id }),
      );
    }
  }

  async function removeTrackedOpenLobby(matchId: number) {
    try {
      await removeOpenLobby(matchId, await getDb());
    } catch (error) {
      logger.warn("dojo open lobby removal failed", { error, lobbyId: matchId });
    }
  }

  type ManagedRunTimer = "countdownTimer" | "inactivityTimer" | "lobbyCloseTimer";

  function clearRunTimer(run: ActiveRun, timer: ManagedRunTimer) {
    const activeTimer = run[timer];
    if (!activeTimer) {
      return;
    }

    clearTimeout(activeTimer);
    delete run[timer];
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
    return runRegistry.isTracked(run);
  }

  function isActiveRun(run: ActiveRun) {
    return run.status !== "aborted" && isTrackedRun(run);
  }

  function getCurrentBeatmap(run: ActiveRun): CourseDefinition["beatmaps"][number] {
    const beatmap = run.course.beatmaps[run.currentBeatmapIndex];
    if (!beatmap) {
      throw new Error(
        `Missing beatmap at index ${run.currentBeatmapIndex} for course ${run.course.id}.`,
      );
    }

    return beatmap;
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

    for (const run of runRegistry.snapshot()) {
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

    const systemDetail = await getDanSystemDetailByNameKey(
      command.systemNameKey,
      database,
    );
    const normalizedCourseNameKey = kebabizeName(command.courseNameKey);
    const course =
      systemDetail?.courses.find(
        (candidate) => kebabizeName(candidate.name) === normalizedCourseNameKey,
      ) ?? null;
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
    const system = systemDetail!.system;
    const capabilities = systemCapabilities(system.status);
    if (!capabilities.playable) {
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
      system,
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

    runRegistry.register(run);
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
      const lobbyTitle = getLobbyTitle(system, course);
      if (!capabilities.persistRuns) {
        await safeSendUserMessage(
          user,
          `Creating multiplayer room ${lobbyTitle}. Results will not be saved. Watch for an invite from BanchoBot.`,
        );
      } else {
        await safeSendUserMessage(
          user,
          `Creating multiplayer room ${lobbyTitle}. Download the maps before joining: ${getCoursePageUrl(system, course)}. Watch for an invite from BanchoBot.`,
        );
      }

      const lobbyChannel = await client.createLobby(lobbyTitle);
      run.lobby = lobbyChannel.lobby;
      await checkAborted();
      runRegistry.attachLobby(run);
      await checkAborted();
      await recordOpenLobbyForRun(run);

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
    runRegistry.addDispose(run, () =>
      run.lobby?.channel.removeListener("message", onLobbyChannelMessage),
    );
    runRegistry.addDispose(run, () => run.lobby?.removeListener("playerJoined", onPlayerJoined));
    runRegistry.addDispose(run, () => run.lobby?.removeListener("matchStarted", onMatchStarted));
    runRegistry.addDispose(run, () => run.lobby?.removeListener("playerFinished", onPlayerFinished));
    runRegistry.addDispose(run, () => run.lobby?.removeListener("playerLeft", onPlayerLeft));
    runRegistry.addDispose(run, () =>
      run.lobby?.removeListener("matchFinished", onMatchFinished),
    );
    runRegistry.addDispose(run, () =>
      run.lobby?.removeListener("matchAborted", onMatchAborted),
    );
  }

  async function handleMatchFinished(run: ActiveRun) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const beatmap = getCurrentBeatmap(run);
    const hasConfirmedFinish = run.targetPlayerFinishedCurrentMap !== null;
    const scoreFetchOptions = hasConfirmedFinish
      ? {
          totalBudgetMs: CONFIRMED_FINISH_SCORE_FETCH_TOTAL_BUDGET_MS,
          perCallTimeoutMs: CONFIRMED_FINISH_SCORE_FETCH_CALL_TIMEOUT_MS,
          retryDelayMs: CONFIRMED_FINISH_SCORE_FETCH_RETRY_DELAY_MS,
        }
      : {
          totalBudgetMs: STANDARD_SCORE_FETCH_TOTAL_BUDGET_MS,
          perCallTimeoutMs: STANDARD_SCORE_FETCH_CALL_TIMEOUT_MS,
          retryDelayMs: STANDARD_SCORE_FETCH_RETRY_DELAY_MS,
        };
    let fetchedScore: NormalizedPlayerMapScore;

    const scoreFetchRequest = {
        lobbyId: run.lobby.id,
        beatmapId: beatmap.beatmapId,
        userId: run.playerUserId,
        processedGameIds: run.processedGameIds,
        ...scoreFetchOptions,
    };

    try {
      fetchedScore = await fetchScore(scoreFetchRequest);
    } catch (error) {
      if (!isActiveRun(run)) {
        return;
      }

      if (error instanceof NoPlayerScoreInGameError) {
        logger.warn(
          "dojo score not found",
          getRunLogFields(run, {
            error,
            beatmapId: beatmap.beatmapId,
            gameId: error.gameId,
            elapsedMs: error.elapsedMs,
            attempts: error.attempts,
            hadConfirmedFinish: hasConfirmedFinish,
          }),
        );
        await abortRun(run, "score-not-found", SCORE_NOT_FOUND_MESSAGE);
        return;
      }

      if (error instanceof NoGameInApiError) {
        if (hasConfirmedFinish) {
          logger.warn(
            "dojo score not yet published",
            getRunLogFields(run, {
              error,
              beatmapId: beatmap.beatmapId,
              elapsedMs: error.elapsedMs,
              attempts: error.attempts,
            }),
          );
          await abortRun(run, "score-not-yet-published", SCORE_NOT_YET_PUBLISHED_MESSAGE);
          return;
        }

        await abortUnconfirmedScoreResolution(run, beatmap.beatmapId, error);
        return;
      }

      if (error instanceof ScoreApiTimeoutError) {
        if (hasConfirmedFinish) {
          logger.error(
            "dojo score api timeout",
            getRunLogFields(run, {
              error,
              beatmapId: beatmap.beatmapId,
              elapsedMs: error.elapsedMs,
              attempts: error.attempts,
              hadConfirmedFinish: true,
              lastUnderlyingError: error.lastUnderlyingError,
            }),
          );
          await abortRun(run, "score-api-timeout", SCORE_API_TIMEOUT_MESSAGE);
          return;
        }

        await abortUnconfirmedScoreResolution(
          run,
          beatmap.beatmapId,
          error,
          { cause: "api-timeout" },
        );
        return;
      }

      throw error;
    }

    if (!isActiveRun(run)) {
      return;
    }

    fetchedScore = await refetchSmallPartialPlayGap(
      run,
      beatmap,
      fetchedScore,
      scoreFetchRequest,
    );

    if (!isActiveRun(run)) {
      return;
    }

    run.processedGameIds.add(fetchedScore.gameId);

    const playedObjects = totalHitObjects(fetchedScore);
    const isPartialPlay =
      beatmap.totalObjects !== null && playedObjects < beatmap.totalObjects;
    const globalTokens = parseModBitmask(fetchedScore.globalGameMods);
    const playerTokens = parseModBitmask(fetchedScore.playerEnabledMods);
    const playedTokenList = uniqueTokens([...globalTokens, ...playerTokens]);
    const playedMods = formatModsCanonical(playedTokenList);
    logUnknownModTokens(run, beatmap.beatmapId, playedTokenList);
    const score =
      run.course.scoreModel === "scorev2"
        ? computeAdjustedScore(fetchedScore.score, playedTokenList)
        : fetchedScore.score;
    const freemodViolation = getFreemodViolation(beatmap, playerTokens);

    const judgedMap = evaluateMapConditions(beatmap.passConditions, {
      accuracy: fetchedScore.accuracy,
      score,
      countMiss: fetchedScore.countMiss,
      maxCombo: fetchedScore.maxCombo,
    });

    const judgedMapResult = {
      gameId: fetchedScore.gameId,
      beatmapId: beatmap.beatmapId,
      mods: ensureNoFailMods(beatmap.mods),
      passConditions: beatmap.passConditions,
      ordinal: beatmap.ordinal,
      score,
      rawScore: fetchedScore.score,
      playedMods,
      accuracy: fetchedScore.accuracy,
      maxCombo: fetchedScore.maxCombo,
      count300: fetchedScore.count300,
      count100: fetchedScore.count100,
      count50: fetchedScore.count50,
      countMiss: fetchedScore.countMiss,
      passed: !isPartialPlay && !freemodViolation && judgedMap.passed,
      createdAt: Date.now(),
    } satisfies Omit<JudgedMapResult, "id" | "runId">;

    run.mapResults.push(judgedMapResult);
    const isFinalMap = run.currentBeatmapIndex === run.course.beatmaps.length - 1;
    const mapEvaluationContext = {
      scoreModel: run.course.scoreModel,
      mapContext: {
        rawValue: fetchedScore.score,
        fixedMods: beatmap.mods,
        playedTokens: playedTokenList,
        freemod: beatmap.freemod,
      },
    } satisfies FormatEvaluationContext;

    if (isPartialPlay) {
      logger.warn(
        "dojo partial play detected",
        getRunLogFields(run, {
          beatmapId: beatmap.beatmapId,
          passed: false,
          playedObjects,
          expectedObjects: beatmap.totalObjects,
          thresholdPassed: judgedMap.passed,
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
          passed: judgedMapResult.passed,
          rawScore: fetchedScore.score,
          score,
          playedMods,
          accuracy: fetchedScore.accuracy,
          conditions: judgedMap.evaluations,
          freemodViolation,
        }),
      );

      await safeSendLobbyMessage(
        run.lobby,
        `Map ${beatmap.ordinal}: ${judgedMapResult.passed ? "PASS" : "FAIL"}`,
      );
      for (const evaluation of judgedMap.evaluations) {
        await safeSendLobbyMessage(
          run.lobby,
          `  ${formatEvaluation(evaluation, mapEvaluationContext)}`,
        );
      }
      if (freemodViolation) {
        await safeSendLobbyMessage(
          run.lobby,
          `  ${formatFreemodViolation(freemodViolation)}`,
        );
      }
      if (beatmap.freemod && !playedTokenList.includes("NF")) {
        await safeSendLobbyMessage(
          run.lobby,
          `${run.playerUsername}: played without NF - add NF on FreeMod maps so a fail still submits a score.`,
        );
      }
      const courseProgressLine = buildCourseProgressLine(run);
      if (courseProgressLine) {
        await safeSendLobbyMessage(run.lobby, courseProgressLine);
      }
    }

    if (!isActiveRun(run)) {
      return;
    }

    if (!isFinalMap && !run.impossibilityAnnounced) {
      const passability = assessCoursePassability(run.course, run.mapResults);
      if (!passability.passable) {
        const sent = await safeSendLobbyMessage(
          run.lobby,
          formatCourseImpossibilityMessage(passability.reasons),
        );
        run.impossibilityAnnounced = true;
        logger.info(
          "dojo course impossibility announced",
          getRunLogFields(run, { reasons: passability.reasons }),
        );
        if (!sent) {
          logger.warn(
            "dojo course impossibility announcement send failed",
            getRunLogFields(run, { reasons: passability.reasons }),
          );
        }
      }
    }

    if (!isActiveRun(run)) {
      return;
    }

    if (isFinalMap) {
      await finalizeRun(run);
      return;
    }

    run.currentBeatmapIndex += 1;
    await queueNextBeatmap(run);
  }

  async function refetchSmallPartialPlayGap(
    run: ActiveRun,
    beatmap: CourseDefinition["beatmaps"][number],
    fetchedScore: NormalizedPlayerMapScore,
    scoreFetchRequest: Parameters<FetchScore>[0],
  ): Promise<NormalizedPlayerMapScore> {
    const playedObjects = totalHitObjects(fetchedScore);

    if (
      beatmap.totalObjects === null ||
      playedObjects >= beatmap.totalObjects ||
      !isSmallPartialPlayGap(playedObjects, beatmap.totalObjects)
    ) {
      return fetchedScore;
    }

    logger.warn(
      "dojo partial play refetch scheduled",
      getRunLogFields(run, {
        beatmapId: beatmap.beatmapId,
        playedObjects,
        expectedObjects: beatmap.totalObjects,
        gap: beatmap.totalObjects - playedObjects,
      }),
    );

    await sleep(PARTIAL_PLAY_REFETCH_DELAY_MS);

    if (!isActiveRun(run)) {
      return fetchedScore;
    }

    try {
      const refetchedScore = await fetchScore(scoreFetchRequest);
      logger.info(
        "dojo partial play refetch completed",
        getRunLogFields(run, {
          beatmapId: beatmap.beatmapId,
          firstPlayedObjects: playedObjects,
          refetchedPlayedObjects: totalHitObjects(refetchedScore),
          expectedObjects: beatmap.totalObjects,
        }),
      );
      return refetchedScore;
    } catch (error) {
      logger.warn(
        "dojo partial play refetch failed",
        getRunLogFields(run, {
          error,
          beatmapId: beatmap.beatmapId,
          playedObjects,
          expectedObjects: beatmap.totalObjects,
        }),
      );
      return fetchedScore;
    }
  }

  async function abortUnconfirmedScoreResolution(
    run: ActiveRun,
    beatmapId: number,
    error: unknown,
    fields?: BotLogFields,
  ) {
    const playerState = await refreshTargetPlayerState(
      run,
      "dojo interrupted score state refresh failed",
    );
    if (playerState === BanchoLobbyPlayerStates.NoMap) {
      await abortMissingMap(run, beatmapId);
      return;
    }

    logger.warn(
      "dojo interrupted run detected while resolving score",
      getRunLogFields(run, {
        error,
        beatmapId,
        hadConfirmedFinish: false,
        ...fields,
      }),
    );
    await abortRun(run, "match-interrupted", MATCH_INTERRUPTED_MESSAGE);
  }

  async function abortMissingMap(run: ActiveRun, beatmapId?: number) {
    run.startInFlight = false;
    logger.warn("dojo player missing map", getRunLogFields(run, { beatmapId }));
    await abortRun(run, "missing-map", MISSING_MAP_MESSAGE);
  }

  async function queueNextBeatmap(run: ActiveRun) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const restDurationMs = timings.restDurationMs;
    const countdownSeconds = Math.max(0, Math.round(restDurationMs / 1000));
    await configureCurrentBeatmap(run, "between_maps");

    await announceCurrentBeatmap(run, countdownSeconds);
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

    await configureCurrentBeatmap(run, "countdown");

    if (optionsForMap.announceStart) {
      await announceCurrentBeatmap(run, optionsForMap.countdownSeconds);
    }
    await sendLobbyTimer(run.lobby, optionsForMap.countdownSeconds);

    touchRunProgress(run);
    queuePureStart(run, Math.max(0, optionsForMap.countdownSeconds) * 1000);
  }

  async function announceCurrentBeatmap(run: ActiveRun, countdownSeconds: number) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const beatmap = getCurrentBeatmap(run);
    await safeSendLobbyMessage(
      run.lobby,
      `Map ${beatmap.ordinal}/${run.course.beatmaps.length}: beatmap ${beatmap.beatmapId} with ${formatAnnouncedMods(
        beatmap.mods,
      )}. Starting in ${countdownSeconds}s.`,
    );
    for (const line of buildPreMapGuidance({
      course: run.course,
      beatmap,
      priorMapResults: run.mapResults,
      isFinalMap: run.currentBeatmapIndex === run.course.beatmaps.length - 1,
      courseAlreadyImpossible: run.impossibilityAnnounced === true,
    })) {
      await safeSendLobbyMessage(run.lobby, line);
    }
  }

  async function configureCurrentBeatmap(
    run: ActiveRun,
    status: "countdown" | "between_maps",
  ) {
    if (!run.lobby) {
      throw new Error("Missing lobby state for active run.");
    }

    const beatmap = getCurrentBeatmap(run);

    run.targetPlayerFinishedCurrentMap = null;
    if (status === "countdown") {
      transitionRunStatus(run, "countdown");
    } else {
      transitionRunStatus(run, "between_maps");
    }
    await run.lobby.setMap(beatmap.beatmapId);
    await run.lobby.setMods(normalizeLobbyMods(beatmap.mods), beatmap.freemod);
    await run.lobby.setSettings(
      TEAM_MODE_HEAD_TO_HEAD,
      getLobbyWinCondition(run.course.scoreModel),
      1,
    );
  }

  function sendLobbyTimer(lobby: LobbyLike, countdownSeconds: number) {
    if (countdownSeconds <= 0) {
      return Promise.resolve(false);
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
      await abortMissingMap(
        run,
        getCurrentBeatmap(run).beatmapId,
      );
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
    if (!run.lobby) {
      return;
    }

    if (runtimeState.clientDisconnected) {
      return;
    }

    const lobbyId = run.lobby.id;
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
        getRunLogFields(run, { lobbyId }),
      );
      await removeTrackedOpenLobby(lobbyId);
      return;
    }

    if (closeResult.error) {
      logger.warn(
        "dojo lobby close failed",
        getRunLogFields(run, {
          error: closeResult.error,
          lobbyId,
        }),
      );
      await removeTrackedOpenLobby(lobbyId);
      return;
    }

    await removeTrackedOpenLobby(lobbyId);
    logger.info("dojo lobby closed", getRunLogFields(run, { lobbyId }));
  }

  async function abortQueuedCountdown(run: ActiveRun) {
    if (!isWaitingToStart(run) || !run.lobby) {
      return;
    }

    let abortReason: RunEndedReason =
      run.status === "between_maps" ? "next-map-start-failed" : "start-failed";
    const restCountdownSeconds = Math.max(0, Math.round(timings.restDurationMs / 1000));
    let message =
      run.status === "between_maps"
        ? `Run aborted: the next map did not start after the ${restCountdownSeconds}s countdown.`
        : "Run aborted: the match failed to start.";

    const playerState = await refreshTargetPlayerState(
      run,
      "dojo start abort state refresh failed",
    );
    if (playerState === BanchoLobbyPlayerStates.NoMap) {
      abortReason = "missing-map";
      message = MISSING_MAP_MESSAGE;
      logger.warn(
        "dojo player missing map",
        getRunLogFields(run, {
          beatmapId: getCurrentBeatmap(run).beatmapId,
        }),
      );
    }

    await abortRun(run, abortReason, message);
  }

  function getRunFinalStatus(run: ActiveRun) {
    if (run.mapResults.length === 0) {
      return { passed: false, allMapsPassed: false, overall: [] };
    }

    if (run.mapResults.length !== run.course.beatmaps.length) {
      return { passed: false, allMapsPassed: false, overall: [] };
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

      runRegistry.disposeAll(run);
      runRegistry.unregister(run);

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
      delete run.lobbyCloseTimer;
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
    if (!systemCapabilities(run.system.status).persistRuns) {
      logger.info("dojo run completed without persistence", getRunLogFields(run));
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
    const finalLine =
      judgedDan.overall.length > 0
        ? `${judgedDan.passed ? "PASS" : "FAIL"} - ${judgedDan.overall
            .map((evaluation) =>
              formatEvaluation(evaluation, { scoreModel: run.course.scoreModel }),
            )
            .join(", ")}`
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
    reason: RunEndedReason,
    message: string,
    opts?: { closeDelayMs?: number },
  ) {
    await terminateRun(run, {
      transition: "aborted",
      cleanupReason: reason,
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
      ...(opts?.closeDelayMs !== undefined ? { closeDelayMs: opts.closeDelayMs } : {}),
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

  async function cleanupStaleOpenLobbies() {
    try {
      const db = await getDb();
      const rows = await listOpenLobbies(db);
      if (rows.length === 0) {
        return;
      }

      if (typeof client.getChannel !== "function") {
        logger.warn("dojo open lobby cleanup skipped (client has no getChannel)");
        return;
      }

      const getChannel = client.getChannel.bind(client) as (
        name: string,
      ) => BanchoChannelLike | undefined;
      for (const row of rows) {
        const channelName = `#mp_${row.matchId}`;
        const channel = getChannel(channelName);
        if (!channel) {
          logger.warn("dojo open lobby getChannel returned undefined", {
            lobbyId: row.matchId,
            channelName,
          });
          continue;
        }

        try {
          await channel.join();
        } catch (error) {
          logger.warn("dojo open lobby join failed", {
            error,
            lobbyId: row.matchId,
            channelName,
          });
          continue;
        }

        try {
          if (channel.lobby) {
            await channel.lobby.closeLobby();
          } else {
            await channel.sendMessage("!mp close");
          }
        } catch (error) {
          logger.warn("dojo open lobby close failed", {
            error,
            lobbyId: row.matchId,
            channelName,
          });
        }

        await removeTrackedOpenLobby(row.matchId);
        void channel.leave().catch((error) => {
          logger.warn("dojo open lobby leave failed", {
            error,
            lobbyId: row.matchId,
            channelName,
          });
        });
      }
    } catch (error) {
      logger.warn("dojo open lobby cleanup failed", { error });
    }
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
      await cleanupStaleOpenLobbies();
    },
    async stop() {
      client.removeListener("PM", onPrivateMessage);
      client.removeListener("disconnected", onClientDisconnected);
      client.removeListener("state", onClientState);

      const activeRuns = runRegistry.snapshot();
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

interface FormatEvaluationContext {
  scoreModel: CourseDefinition["scoreModel"];
  mapContext?: {
    rawValue: number;
    fixedMods: string;
    playedTokens: readonly string[];
    freemod: boolean;
  };
}

function formatEvaluation(
  evaluation: JudgedThreshold,
  context: FormatEvaluationContext,
) {
  const display = getEvaluationDisplay(evaluation, context);

  return `${display.label}: ${formatConditionValue(
    evaluation.type,
    display.value,
  )} (target ${evaluation.comparison} ${formatConditionValue(
    evaluation.type,
    display.threshold,
  )})`;
}

function formatFreemodViolation(violation: { rejected: string[] }) {
  return `Disallowed mods: ${violation.rejected.join(", ")}`;
}

function getEvaluationDisplay(
  evaluation: JudgedThreshold,
  context: FormatEvaluationContext,
) {
  if (
    evaluation.type === "score" &&
    context.scoreModel === "scorev2" &&
    context.mapContext
  ) {
    const rawThreshold = rawTargetForAdjustedRemaining(
      evaluation.threshold,
      context.mapContext.freemod
        ? context.mapContext.playedTokens
        : parseCourseMods(validateCourseMods(context.mapContext.fixedMods)),
    );

    return {
      label: "raw score",
      value: context.mapContext.rawValue,
      threshold: rawThreshold,
    };
  }

  return {
    label: formatEvaluationLabel(evaluation.type, context),
    value: evaluation.value,
    threshold: evaluation.threshold,
  };
}

function formatEvaluationLabel(
  type: JudgedThreshold["type"],
  context: FormatEvaluationContext,
) {
  switch (type) {
    case "accuracy":
      return "accuracy";
    case "score":
      return "score";
    case "missCount":
      return "miss";
    case "maxCombo":
      return "combo";
    case "courseAccuracy":
      return "course accuracy";
    case "totalScore":
      return context.scoreModel === "scorev2" ? "adjusted total score" : "total score";
    case "totalMissCount":
      return "total miss";
  }
}

function buildCourseProgressLine(run: ActiveRun): string | null {
  if (run.course.overallPassConditions.length === 0) {
    return null;
  }

  const passedAccuracy = run.mapResults.reduce(
    (total, result) => total + (result.passed ? result.accuracy : 0),
    0,
  );
  const totalMisses = run.mapResults.reduce(
    (total, result) => total + result.countMiss,
    0,
  );
  const totalScore = run.mapResults.reduce(
    (total, result) => total + result.score,
    0,
  );
  const segments = run.course.overallPassConditions.map((condition) => {
    switch (condition.type) {
      case "courseAccuracy":
        return `courseAccuracy ${formatPercentage(passedAccuracy)} / ${formatPercentage(
          condition.threshold,
        )}`;
      case "totalMissCount":
        return `totalMissCount ${formatInteger(totalMisses)} / ${formatInteger(
          condition.threshold,
        )}`;
      case "totalScore":
        return `${
          run.course.scoreModel === "scorev2" ? "adjusted total score" : "total score"
        } ${formatInteger(totalScore)} / ${formatInteger(condition.threshold)}`;
    }
  });

  return `Course targets: ${segments.join("; ")}`;
}

function formatCourseImpossibilityMessage(reasons: CourseImpossibilityReason[]) {
  return `Course cannot pass: ${reasons
    .map(formatCourseImpossibilityReason)
    .join("; ")}. Continuing remaining maps.`;
}

function formatCourseImpossibilityReason(reason: CourseImpossibilityReason) {
  switch (reason.type) {
    case "mapFailed":
      return `map ${reason.mapOrdinal} threshold failed`;
    case "totalMissCountExceeded":
      return "totalMissCount threshold exceeded";
    case "courseAccuracyUnreachable":
      return "courseAccuracy threshold unreachable";
  }
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

function getFreemodViolation(
  beatmap: CourseDefinition["beatmaps"][number],
  playerTokens: string[],
): { rejected: string[] } | null {
  if (!beatmap.freemod) {
    return null;
  }

  const courseTokens = new Set(parseCourseMods(validateCourseMods(beatmap.mods)));
  const playerSelectedTokens = playerTokens.filter(
    (token) => token !== "NF" && !courseTokens.has(token),
  );
  const validation = validateFreemodPlayerSelection(playerSelectedTokens);

  return validation.ok ? null : { rejected: validation.rejected };
}

function uniqueTokens(tokens: string[]) {
  return [...new Set(tokens)];
}

function isSmallPartialPlayGap(playedObjects: number, totalObjects: number) {
  const gap = totalObjects - playedObjects;

  return gap <= 2 || playedObjects / totalObjects >= 0.99;
}

function ensureNoFailMods(mods: string) {
  const compact = mods.toUpperCase().replace(/\s+/g, "");
  return compact.includes("NF") ? compact : `${compact}NF`;
}

const formatAnnouncedMods = formatVisibleCourseMods;

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

function getCoursePageUrl(system: DanSystemDefinition, course: CourseDefinition) {
  const baseUrl = (process.env["DOJO_SITE_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
  return `${baseUrl}/dan/${encodeURIComponent(
    kebabizeName(system.name),
  )}?course=${encodeURIComponent(kebabizeName(course.name))}`;
}

function getLobbyTitle(system: DanSystemDefinition, course: CourseDefinition) {
  return `osu!dojo: ${system.name} / ${course.name}`;
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
