const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface AuthEnvironment {
  siteOrigin: string;
  callbackUrl: string;
  secureCookies: boolean;
  sessionSecret: string;
  dummyAuth: boolean;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
}

export function validateAuthEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AuthEnvironment {
  const sessionSecret = environment["SESSION_SECRET"];
  if (!sessionSecret || new TextEncoder().encode(sessionSecret).byteLength < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 UTF-8 bytes.");
  }

  const siteUrl = environment["DOJO_SITE_URL"];
  if (!siteUrl) {
    throw new Error("DOJO_SITE_URL is required.");
  }

  const parsed = parseSiteUrl(siteUrl);
  const dummyAuth = environment["DOJO_E2E_AUTH"] === "1";
  if (dummyAuth && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("DOJO_E2E_AUTH requires a loopback DOJO_SITE_URL.");
  }

  const oauthClientId = environment["OSU_OAUTH_CLIENT_ID"]?.trim() || null;
  const oauthClientSecret = environment["OSU_OAUTH_CLIENT_SECRET"]?.trim() || null;
  if (!dummyAuth && (!oauthClientId || !oauthClientSecret)) {
    throw new Error(
      "OSU_OAUTH_CLIENT_ID and OSU_OAUTH_CLIENT_SECRET are required outside dummy auth mode.",
    );
  }

  return {
    siteOrigin: parsed.origin,
    callbackUrl: `${parsed.origin}/api/auth/osu/callback`,
    secureCookies: parsed.protocol === "https:",
    sessionSecret,
    dummyAuth,
    oauthClientId,
    oauthClientSecret,
  };
}

export function isLoopbackHostname(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function assertDummyRequestHost(request: Request, auth = validateAuthEnv()) {
  if (auth.dummyAuth && !isLoopbackHostname(new URL(request.url).hostname)) {
    throw new Error("Dummy auth requests must use a loopback hostname.");
  }
}

function parseSiteUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DOJO_SITE_URL must be an absolute http(s) origin.");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "DOJO_SITE_URL must be an http(s) origin without credentials, path, query, or fragment.",
    );
  }

  return parsed;
}
