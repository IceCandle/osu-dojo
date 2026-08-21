const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const DEFAULT_REFRESH_SKEW_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface OsuAccessTokenProvider {
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<string>;
}

export class OsuTokenError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(message: string, options: { retryable: boolean; status?: number }) {
    super(message);
    this.name = "OsuTokenError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface CreateOsuTokenProviderOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
  requestTimeoutMs?: number;
  tokenUrl?: string;
}

export function createOsuTokenProvider(
  options: CreateOsuTokenProviderOptions,
): OsuAccessTokenProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const tokenUrl = options.tokenUrl ?? TOKEN_URL;
  let cachedToken: CachedToken | undefined;
  let inFlight: Promise<string> | undefined;
  let forcedInFlight: Promise<string> | undefined;

  return {
    async getAccessToken(requestOptions = {}) {
      if (requestOptions.forceRefresh) {
        if (forcedInFlight) {
          return forcedInFlight;
        }

        const previousRequest = inFlight;
        const forcedRequest = (async () => {
          if (previousRequest) {
            try {
              await previousRequest;
            } catch {
              // A forced refresh still gets its own attempt after an older failure.
            }
          }
          return startTokenRequest();
        })();
        forcedInFlight = forcedRequest;

        try {
          return await forcedRequest;
        } finally {
          if (forcedInFlight === forcedRequest) {
            forcedInFlight = undefined;
          }
        }
      }

      if (inFlight) {
        return inFlight;
      }

      if (
        cachedToken &&
        cachedToken.expiresAt - refreshSkewMs > now()
      ) {
        return cachedToken.accessToken;
      }

      return startTokenRequest();
    },
  };

  async function startTokenRequest() {
    if (inFlight) {
      return inFlight;
    }

    const request = requestToken({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      fetchImpl,
      now,
      requestTimeoutMs,
      tokenUrl,
    }).then((token) => {
      cachedToken = token;
      return token.accessToken;
    });
    inFlight = request;

    try {
      return await request;
    } finally {
      if (inFlight === request) {
        inFlight = undefined;
      }
    }
  }
}

let defaultProvider: OsuAccessTokenProvider | undefined;

export function getDefaultOsuTokenProvider(): OsuAccessTokenProvider {
  defaultProvider ??= createOsuTokenProvider({
    clientId: requiredEnv("OSU_OAUTH_CLIENT_ID"),
    clientSecret: requiredEnv("OSU_OAUTH_CLIENT_SECRET"),
  });
  return defaultProvider;
}

async function requestToken(options: {
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
  now: () => number;
  requestTimeoutMs: number;
  tokenUrl: string;
}): Promise<CachedToken> {
  const timeoutMs = Math.max(0, options.requestTimeoutMs);
  const controller = new AbortController();
  const timeoutError = () =>
    new OsuTokenError(
      `osu! token request timed out after ${timeoutMs}ms.`,
      { retryable: true },
    );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let response: Response;
  let payload: unknown;

  try {
    const operation = (async () => {
      let tokenResponse: Response;
      try {
        tokenResponse = await options.fetchImpl(options.tokenUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            grant_type: "client_credentials",
            scope: "public",
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw timeoutError();
        }
        throw new OsuTokenError(toErrorMessage(error), { retryable: true });
      }

      if (!tokenResponse.ok) {
        return { response: tokenResponse };
      }

      try {
        return { response: tokenResponse, payload: await tokenResponse.json() };
      } catch (error) {
        if (controller.signal.aborted) {
          throw timeoutError();
        }
        throw new OsuTokenError("osu! token endpoint returned malformed JSON.", {
          retryable: false,
          status: tokenResponse.status,
        });
      }
    })();

    const result = await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(timeoutError());
        }, timeoutMs);
      }),
    ]);
    response = result.response;
    payload = result.payload;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    throw new OsuTokenError(`osu! token endpoint returned HTTP ${response.status}.`, {
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    });
  }

  if (
    !isRecord(payload) ||
    typeof payload["access_token"] !== "string" ||
    payload["access_token"].length === 0 ||
    typeof payload["expires_in"] !== "number" ||
    !Number.isFinite(payload["expires_in"]) ||
    payload["expires_in"] <= 0
  ) {
    throw new OsuTokenError("osu! token response was invalid.", {
      retryable: false,
      status: response.status,
    });
  }

  return {
    accessToken: payload["access_token"],
    expiresAt: options.now() + payload["expires_in"] * 1000,
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
