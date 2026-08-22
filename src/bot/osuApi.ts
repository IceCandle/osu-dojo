import { sleep as defaultSleep } from "@/lib/sleep";
import {
  findLatestGame,
  normalizeModernPlayerScore,
  type MatchWindowFetcher,
  type NormalizedPlayerMapScore,
} from "@/lib/osu/matches";
import {
  FetchTransportError,
  OsuApiDeadlineError,
} from "@/lib/osu/client";
import { OsuTokenError } from "@/lib/osu/token";

export type { NormalizedPlayerMapScore } from "@/lib/osu/matches";
export { FetchTransportError } from "@/lib/osu/client";

export interface FetchScoreOptions {
  beatmapId: number;
  userId: number;
  processedGameIds: Set<number>;
  deadlineDurationMs: number;
  retryDelayMs: number;
  retryDelayMinMs?: number;
  retryBackoffFactor?: number;
  retryDelayMaxMs?: number;
  fetchMatchWindow: MatchWindowFetcher;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
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

export async function fetchLatestPlayerMapScore(
  options: FetchScoreOptions,
): Promise<NormalizedPlayerMapScore> {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const deadline = startedAt + options.deadlineDurationMs;
  const retryBackoffFactor = options.retryBackoffFactor ?? 2;
  const retryDelayMaxMs = options.retryDelayMaxMs ?? 8_000;
  const retryDelayMinMs = options.retryDelayMinMs ?? 1_000;
  if (retryDelayMaxMs < retryDelayMinMs) {
    throw new RangeError(
      "retryDelayMaxMs must be greater than or equal to retryDelayMinMs.",
    );
  }
  let attempts = 0;
  let afterEventId: number | undefined;
  let lastUnderlyingError: Error | null = null;
  let sawGameWithoutPlayerScore:
    | { gameId: number; userId: number }
    | null = null;
  let sawNoGame = false;
  let exhaustedDuringRequest = false;

  while (now() < deadline) {
    attempts += 1;

    try {
      const lookupOptions = {
        beatmapId: options.beatmapId,
        processedGameIds: options.processedGameIds,
        fetchWindow: options.fetchMatchWindow,
        ...(afterEventId === undefined ? {} : { afterEventId }),
      };
      const result = await findLatestGame(lookupOptions);

      if (result.game) {
        const playerScore = result.game.scores.find(
          (score) => score.userId === options.userId,
        );
        if (playerScore) {
          return normalizeModernPlayerScore(result.game, playerScore);
        }
        sawGameWithoutPlayerScore = {
          gameId: result.game.id,
          userId: options.userId,
        };
      } else {
        afterEventId = result.latestEventId ?? afterEventId;
        sawNoGame = true;
      }
    } catch (error) {
      if (
        (error instanceof FetchTransportError && !error.retryable) ||
        (error instanceof OsuTokenError && !error.retryable)
      ) {
        throw error;
      }
      if (error instanceof OsuApiDeadlineError) {
        lastUnderlyingError = error;
        exhaustedDuringRequest = true;
        break;
      }
      lastUnderlyingError = normalizeUnderlyingError(error);
    }

    const retryDelayMs = getRetryDelayMs({
      attempt: attempts,
      baseDelayMs: options.retryDelayMs,
      minDelayMs: retryDelayMinMs,
      factor: retryBackoffFactor,
      maxDelayMs: retryDelayMaxMs,
      random,
    });

    if (now() + retryDelayMs >= deadline) {
      break;
    }

    await sleep(retryDelayMs);
  }

  if (exhaustedDuringRequest) {
    throw new ScoreApiTimeoutError({
      elapsedMs: now() - startedAt,
      attempts,
      lastUnderlyingError,
    });
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

function getRetryDelayMs(args: {
  attempt: number;
  baseDelayMs: number;
  minDelayMs: number;
  factor: number;
  maxDelayMs: number;
  random: () => number;
}) {
  const cap = Math.min(
    args.maxDelayMs,
    args.baseDelayMs * args.factor ** Math.max(0, args.attempt - 1),
  );
  const jitter = Math.max(0, Math.min(1, args.random()));
  return Math.max(args.minDelayMs, Math.floor(jitter * cap));
}

function normalizeUnderlyingError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
