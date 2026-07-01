import { validateAuthEnv } from "@/lib/auth/env";

const AUTHORIZE_URL = "https://osu.ppy.sh/oauth/authorize";
const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const ME_URL = "https://osu.ppy.sh/api/v2/me/osu";
const PROVIDER_TIMEOUT_MS = 10_000;

export interface OsuUser {
  id: number;
  username: string;
}

export class OAuthProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthProviderError";
  }
}

export function buildAuthorizeUrl(state: string) {
  const auth = validateAuthEnv();
  if (auth.dummyAuth) {
    const url = new URL("/api/auth/osu/dummy-authorize", auth.siteOrigin);
    url.searchParams.set("state", state);
    return url;
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", auth.oauthClientId!);
  url.searchParams.set("redirect_uri", auth.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "public identify");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeCodeForToken(
  code: string,
  fetcher: typeof fetch = fetch,
) {
  const auth = validateAuthEnv();
  if (auth.dummyAuth) {
    return "dummy-access-token";
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: auth.oauthClientId!,
    client_secret: auth.oauthClientSecret!,
    redirect_uri: auth.callbackUrl,
    code,
  });
  const response = await providerFetch(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    fetcher,
  );
  const payload: unknown = await safeJson(response);
  if (
    !response.ok ||
    !isRecord(payload) ||
    typeof payload["access_token"] !== "string" ||
    payload["access_token"].length === 0
  ) {
    throw new OAuthProviderError("osu! token response was invalid.");
  }
  return payload["access_token"];
}

export async function fetchOsuUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<OsuUser> {
  const auth = validateAuthEnv();
  if (auth.dummyAuth) {
    return { id: 77, username: "E2EPlayer" };
  }

  const response = await providerFetch(
    ME_URL,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
    fetcher,
  );
  const payload: unknown = await safeJson(response);
  if (
    !response.ok ||
    !isRecord(payload) ||
    typeof payload["id"] !== "number" ||
    !Number.isSafeInteger(payload["id"]) ||
    payload["id"] <= 0 ||
    typeof payload["username"] !== "string" ||
    payload["username"].length < 1 ||
    payload["username"].length > 30
  ) {
    throw new OAuthProviderError("osu! user response was invalid.");
  }
  return { id: payload["id"], username: payload["username"] };
}

async function providerFetch(
  input: string,
  init: RequestInit,
  fetcher: typeof fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch {
    throw new OAuthProviderError("osu! request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new OAuthProviderError("osu! returned malformed JSON.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
