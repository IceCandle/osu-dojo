import { sleep as defaultSleep } from "@/lib/sleep";
import {
  getDefaultOsuTokenProvider,
  OsuTokenError,
  type OsuAccessTokenProvider,
} from "@/lib/osu/token";

// When this pin changes, review every api_version() gate in osu-web for the
// endpoints below. This pin intentionally includes the 20220705 gate that
// exposes the modern Score shape consumed by the match parser.
export const OSU_API_RESPONSE_VERSION = 20260724;

export type OsuRateLimit = "runCritical" | "metadata";

export class FetchTransportError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    retryable: boolean,
    options: { retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "FetchTransportError";
    this.retryable = retryable;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export class OsuApiDeadlineError extends Error {
  constructor() {
    super("osu! API operation deadline was exhausted.");
    this.name = "OsuApiDeadlineError";
  }
}

export interface OsuApiRequestOptions {
  rateLimit: OsuRateLimit;
  deadline: number;
  perCallTimeoutMs: number;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
}

export interface OsuApiClient {
  requestJson<T>(path: string, options: OsuApiRequestOptions): Promise<T>;
}

export interface CreateOsuApiClientOptions {
  tokenProvider?: OsuAccessTokenProvider;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  baseUrl?: string;
  rateLimiters?: Record<OsuRateLimit, InProcessRateLimiter>;
}

export class InProcessRateLimiter {
  private nextAvailableAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  async acquire(options: {
    deadline: number;
    now: () => number;
    sleep: (milliseconds: number) => Promise<void>;
  }) {
    const previous = this.queue;
    let cancelled = false;
    const turn = previous.then(async () => {
      if (cancelled) {
        return;
      }
      const waitMs = Math.max(0, this.nextAvailableAt - options.now());
      assertWaitFitsDeadline(waitMs, options.deadline, options.now);
      if (waitMs > 0) {
        await options.sleep(waitMs);
      }
      if (cancelled) {
        return;
      }
      this.nextAvailableAt = options.now() + this.intervalMs;
    });
    this.queue = turn.catch(() => {});

    try {
      await waitForPromiseWithinDeadline(
        turn,
        options.deadline,
        options.now,
      );
    } catch (error) {
      cancelled = true;
      throw error;
    }
  }
}

export function createOsuApiClient(
  options: CreateOsuApiClientOptions = {},
): OsuApiClient {
  const tokenProvider = options.tokenProvider ?? getDefaultOsuTokenProvider();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const baseUrl = options.baseUrl ?? "https://osu.ppy.sh";
  const rateLimiters = options.rateLimiters ?? {
    runCritical: new InProcessRateLimiter(1_000),
    metadata: new InProcessRateLimiter(2_000),
  };

  return {
    async requestJson<T>(path: string, requestOptions: OsuApiRequestOptions) {
      let attempt = 0;
      let refreshedAfter401 = false;
      let forceNextToken = false;

      while (now() < requestOptions.deadline) {
        attempt += 1;
        let accessToken: string;
        try {
          accessToken = await waitForPromiseWithinDeadline(
            tokenProvider.getAccessToken({
              forceRefresh: forceNextToken,
            }),
            requestOptions.deadline,
            now,
          );
          forceNextToken = false;
        } catch (error) {
          if (!(error instanceof OsuTokenError) || !error.retryable) {
            throw error;
          }
          await waitForRetry({
            attempt,
            deadline: requestOptions.deadline,
            now,
            sleep,
            random,
          });
          continue;
        }

        await rateLimiters[requestOptions.rateLimit].acquire({
          deadline: requestOptions.deadline,
          now,
          sleep,
        });

        let response: Response;
        let payload: unknown;
        try {
          const headers = new Headers(requestOptions.headers);
          headers.set("Accept", "application/json");
          headers.set("Authorization", `Bearer ${accessToken}`);
          headers.set("x-api-version", String(OSU_API_RESPONSE_VERSION));
          const init: RequestInit = {
            headers,
            ...(requestOptions.method === undefined
              ? {}
              : { method: requestOptions.method }),
            ...(requestOptions.body === undefined
              ? {}
              : { body: requestOptions.body }),
          };
          const result = await fetchWithTimeout(
            new URL(path, baseUrl),
            init,
            {
              deadline: requestOptions.deadline,
              timeoutMs: requestOptions.perCallTimeoutMs,
              fetchImpl,
              now,
            },
          );
          response = result.response;
          payload = result.payload;
        } catch (error) {
          if (error instanceof OsuApiDeadlineError) {
            throw error;
          }
          const transportError =
            error instanceof FetchTransportError
              ? error
              : new FetchTransportError(toErrorMessage(error), true);
          if (!transportError.retryable) {
            throw transportError;
          }
          await waitForRetry({
            attempt,
            deadline: requestOptions.deadline,
            now,
            sleep,
            random,
            ...(transportError.retryAfterMs === null
              ? {}
              : { retryAfterMs: transportError.retryAfterMs }),
          });
          continue;
        }

        if (response.status === 401 && !refreshedAfter401) {
          refreshedAfter401 = true;
          forceNextToken = true;
          continue;
        }

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const retryAfterMs =
            response.status === 429
              ? parseRetryAfter(response.headers.get("retry-after"), now())
              : null;
          const error = new FetchTransportError(
            `osu! API returned HTTP ${response.status}.`,
            retryable,
            retryAfterMs === null ? {} : { retryAfterMs },
          );
          if (!retryable) {
            throw error;
          }
          await waitForRetry({
            attempt,
            deadline: requestOptions.deadline,
            now,
            sleep,
            random,
            ...(retryAfterMs === null ? {} : { retryAfterMs }),
          });
          continue;
        }

        return payload as T;
      }

      throw new OsuApiDeadlineError();
    },
  };
}

let defaultClient: OsuApiClient | undefined;

export function getDefaultOsuApiClient() {
  defaultClient ??= createOsuApiClient();
  return defaultClient;
}

async function fetchWithTimeout(
  input: URL,
  init: RequestInit,
  options: {
    deadline: number;
    timeoutMs: number;
    fetchImpl: typeof fetch;
    now: () => number;
  },
): Promise<{ response: Response; payload?: unknown }> {
  const remainingMs = options.deadline - options.now();
  if (remainingMs <= 0) {
    throw new OsuApiDeadlineError();
  }
  const timeoutMs = Math.max(0, Math.min(options.timeoutMs, remainingMs));
  const controller = new AbortController();
  const timeoutError = () =>
    new FetchTransportError(
      `osu! API request timed out after ${timeoutMs}ms.`,
      true,
    );
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const operation = (async () => {
      let response: Response;
      try {
        response = await options.fetchImpl(input, {
          ...init,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw timeoutError();
        }
        throw new FetchTransportError(toErrorMessage(error), true);
      }

      if (!response.ok) {
        return { response };
      }

      try {
        return { response, payload: await response.json() };
      } catch (error) {
        if (controller.signal.aborted) {
          throw timeoutError();
        }
        throw new FetchTransportError(
          "osu! API returned malformed JSON.",
          false,
        );
      }
    })();

    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(timeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function waitForRetry(options: {
  attempt: number;
  deadline: number;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
  retryAfterMs?: number;
}) {
  const exponentialCap = Math.min(
    8_000,
    1_000 * 2 ** Math.max(0, options.attempt - 1),
  );
  const jitter = Math.max(0, Math.min(1, options.random()));
  const exponentialWaitMs = Math.floor(exponentialCap * jitter);
  const waitMs =
    options.retryAfterMs !== undefined && options.retryAfterMs > 0
      ? options.retryAfterMs
      : exponentialWaitMs;
  assertWaitFitsDeadline(waitMs, options.deadline, options.now);
  if (waitMs > 0) {
    await options.sleep(waitMs);
  }
}

function assertWaitFitsDeadline(
  waitMs: number,
  deadline: number,
  now: () => number,
) {
  if (now() + waitMs >= deadline) {
    throw new OsuApiDeadlineError();
  }
}

async function waitForPromiseWithinDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  now: () => number,
): Promise<T> {
  const remainingMs = deadline - now();
  if (remainingMs <= 0) {
    throw new OsuApiDeadlineError();
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new OsuApiDeadlineError()),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.ceil(Number(trimmed) * 1000));
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
