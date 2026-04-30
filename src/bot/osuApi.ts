import { calculateAccuracy } from "@/lib/accuracy";
import { sleep as defaultSleep } from "@/lib/sleep";

interface LegacyMultiScore {
  userId: number;
  score: number;
  enabledMods: number;
  maxCombo: number;
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  pass: boolean;
}

interface LegacyMultiGame {
  id: number;
  beatmapId: number;
  mods: number;
  scores: LegacyMultiScore[];
}

export interface FetchScoreOptions {
  beatmapId: number;
  userId: number;
  processedGameIds: Set<number>;
  totalBudgetMs: number;
  perCallTimeoutMs: number;
  retryDelayMs: number;
  fetchMatch: (signal: AbortSignal) => Promise<string>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface NormalizedPlayerMapScore {
  gameId: number;
  beatmapId: number;
  userId: number;
  score: number;
  playerEnabledMods: number;
  globalGameMods: number;
  accuracy: number;
  maxCombo: number;
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  passed: boolean;
}

export class FetchTransportError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "FetchTransportError";
    this.retryable = retryable;
  }
}

export class NoGameInApiError extends Error {
  readonly beatmapId: number;
  readonly elapsedMs: number;
  readonly attempts: number;

  constructor(args: { beatmapId: number; elapsedMs: number; attempts: number }) {
    super(`No completed multiplayer game found for beatmap ${args.beatmapId}.`);
    this.name = "NoGameInApiError";
    this.beatmapId = args.beatmapId;
    this.elapsedMs = args.elapsedMs;
    this.attempts = args.attempts;
  }
}

export class NoPlayerScoreInGameError extends Error {
  readonly gameId: number;
  readonly userId: number;
  readonly elapsedMs: number;
  readonly attempts: number;

  constructor(args: {
    gameId: number;
    userId: number;
    elapsedMs: number;
    attempts: number;
  }) {
    super(`Match ${args.gameId} does not include a score for user ${args.userId}.`);
    this.name = "NoPlayerScoreInGameError";
    this.gameId = args.gameId;
    this.userId = args.userId;
    this.elapsedMs = args.elapsedMs;
    this.attempts = args.attempts;
  }
}

export class ScoreApiTimeoutError extends Error {
  readonly elapsedMs: number;
  readonly attempts: number;
  readonly lastUnderlyingError: Error | null;

  constructor(args: {
    elapsedMs: number;
    attempts: number;
    lastUnderlyingError: Error | null;
  }) {
    super("osu! API score resolution timed out.");
    this.name = "ScoreApiTimeoutError";
    this.elapsedMs = args.elapsedMs;
    this.attempts = args.attempts;
    this.lastUnderlyingError = args.lastUnderlyingError;
  }
}

class PerCallTimeoutError extends Error {
  constructor(milliseconds: number) {
    super(`osu! API score fetch timed out after ${milliseconds}ms.`);
    this.name = "PerCallTimeoutError";
  }
}

const ABORT_SETTLEMENT_GRACE_MS = 100;

export async function fetchLatestPlayerMapScore(
  options: FetchScoreOptions,
): Promise<NormalizedPlayerMapScore> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const deadline = startedAt + options.totalBudgetMs;
  let attempts = 0;
  let lastUnderlyingError: Error | null = null;
  let sawGameWithoutPlayerScore:
    | { gameId: number; userId: number }
    | null = null;
  let sawNoGame = false;

  while (now() < deadline) {
    attempts += 1;
    const callTimeoutMs = Math.max(0, Math.min(options.perCallTimeoutMs, deadline - now()));

    try {
      const text = await fetchMatchWithTimeout(options.fetchMatch, callTimeoutMs, sleep);
      const match = parseMatchPayload(text);
      const game = [...match.games]
        .reverse()
        .find(
          (candidate) =>
            candidate.beatmapId === options.beatmapId &&
            !options.processedGameIds.has(candidate.id),
        );

      if (game) {
        const playerScore = game.scores.find(
          (score) => score.userId === options.userId,
        );

        if (playerScore) {
          return normalizePlayerMapScore(game, playerScore);
        }

        sawGameWithoutPlayerScore = {
          gameId: game.id,
          userId: options.userId,
        };
      } else {
        sawNoGame = true;
      }
    } catch (error) {
      if (error instanceof FetchTransportError && !error.retryable) {
        throw error;
      }

      lastUnderlyingError = normalizeUnderlyingError(error);
    }

    if (now() + options.retryDelayMs >= deadline) {
      break;
    }

    await sleep(options.retryDelayMs);
  }

  if (sawGameWithoutPlayerScore) {
    throw new NoPlayerScoreInGameError({
      ...sawGameWithoutPlayerScore,
      elapsedMs: now() - startedAt,
      attempts,
    });
  }

  if (sawNoGame) {
    throw new NoGameInApiError({
      beatmapId: options.beatmapId,
      elapsedMs: now() - startedAt,
      attempts,
    });
  }

  throw new ScoreApiTimeoutError({
    elapsedMs: now() - startedAt,
    attempts,
    lastUnderlyingError,
  });
}

export async function fetchMatchText(
  apiKey: string,
  lobbyId: number,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL("https://osu.ppy.sh/api/get_match");
  url.searchParams.set("k", apiKey);
  url.searchParams.set("mp", String(lobbyId));

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new FetchTransportError(toErrorMessage(error), true);
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new FetchTransportError(`HTTP ${response.status}`, retryable);
  }

  try {
    return await response.text();
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new FetchTransportError(toErrorMessage(error), true);
  }
}

async function fetchMatchWithTimeout(
  fetchMatch: FetchScoreOptions["fetchMatch"],
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<string> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  const timeoutError = new PerCallTimeoutError(timeoutMs);
  const fetchPromise = fetchMatch(controller.signal);
  const settlementTracker = fetchPromise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof PerCallTimeoutError || controller.signal.aborted) {
      if (!settled) {
        await Promise.race([
          settlementTracker,
          sleep(ABORT_SETTLEMENT_GRACE_MS),
        ]);
      }

      throw timeoutError;
    }

    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function parseMatchPayload(text: string): { games: LegacyMultiGame[] } {
  const payload = JSON.parse(text) as unknown;

  if (hasLegacyApiError(payload)) {
    throw new FetchTransportError(String(payload.error), false);
  }

  if (!isRecord(payload) || !Array.isArray(payload.games)) {
    throw new Error("match payload: invalid shape");
  }

  return {
    games: payload.games.map(parseGame),
  };
}

function parseGame(value: unknown): LegacyMultiGame {
  if (!isRecord(value) || !Array.isArray(value.scores)) {
    throw new Error("game: invalid shape");
  }

  return {
    id: parseRequiredNonNegativeInteger(value.game_id, "game_id"),
    beatmapId: parseRequiredNonNegativeInteger(value.beatmap_id, "beatmap_id"),
    mods: parseOptionalNonNegativeInteger(value.mods, "mods"),
    scores: value.scores.map(parseScore),
  };
}

function parseScore(value: unknown): LegacyMultiScore {
  if (!isRecord(value)) {
    throw new Error("score: invalid shape");
  }

  return {
    userId: parseRequiredNonNegativeInteger(value.user_id, "user_id"),
    score: parseRequiredNonNegativeInteger(value.score, "score"),
    enabledMods: parseOptionalNonNegativeInteger(value.enabled_mods, "enabled_mods"),
    maxCombo: parseRequiredNonNegativeInteger(value.maxcombo, "maxcombo"),
    count300: parseRequiredNonNegativeInteger(value.count300, "count300"),
    count100: parseRequiredNonNegativeInteger(value.count100, "count100"),
    count50: parseRequiredNonNegativeInteger(value.count50, "count50"),
    countMiss: parseRequiredNonNegativeInteger(value.countmiss, "countmiss"),
    pass: parsePass(value.pass),
  };
}

function parseRequiredNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${field}: invalid type`);
  }

  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw new Error(`${field}: malformed integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field}: out of range`);
  }

  return parsed;
}

function parseOptionalNonNegativeInteger(value: unknown, field: string): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return parseRequiredNonNegativeInteger(value, field);
}

function parsePass(value: unknown): boolean {
  if (value === "1" || value === 1) {
    return true;
  }

  if (value === "0" || value === 0) {
    return false;
  }

  throw new Error("pass: malformed boolean");
}

function normalizePlayerMapScore(
  game: LegacyMultiGame,
  score: LegacyMultiScore,
): NormalizedPlayerMapScore {
  return {
    gameId: game.id,
    beatmapId: game.beatmapId,
    userId: score.userId,
    score: score.score,
    playerEnabledMods: score.enabledMods,
    globalGameMods: game.mods,
    accuracy: calculateAccuracy({
      count300: score.count300,
      count100: score.count100,
      count50: score.count50,
      countMiss: score.countMiss,
    }),
    maxCombo: score.maxCombo,
    count300: score.count300,
    count100: score.count100,
    count50: score.count50,
    countMiss: score.countMiss,
    passed: score.pass,
  };
}

function normalizeUnderlyingError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function hasLegacyApiError(payload: unknown): payload is { error: unknown } {
  return (
    isRecord(payload) &&
    Object.prototype.hasOwnProperty.call(payload, "error")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
