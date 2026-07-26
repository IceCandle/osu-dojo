import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import {
  dynamic as loginDynamic,
  GET as login,
} from "@/app/api/auth/osu/login/route";
import {
  dynamic as callbackDynamic,
  GET as callback,
} from "@/app/api/auth/osu/callback/route";
import { GET as dummyAuthorize } from "@/app/api/auth/osu/dummy-authorize/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { validateAuthEnv } from "@/lib/auth/env";
import {
  createSession,
  getSessionUser,
  getSessionUserFromToken,
  hashToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { sanitizeReturnTo } from "@/lib/auth/returnTo";
import { exchangeCodeForToken, fetchOsuUser } from "@/lib/auth/osuOAuth";
import { createTempDatabaseUrl } from "./helpers/dbFixtures";

const AUTH_KEYS = [
  "SESSION_SECRET",
  "DOJO_SITE_URL",
  "DOJO_E2E_AUTH",
  "OSU_OAUTH_CLIENT_ID",
  "OSU_OAUTH_CLIENT_SECRET",
] as const;
const SECRET = "osu-dojo-test-session-secret-at-least-32-bytes";

test("OAuth GET routes opt out of static generation", () => {
  assert.equal(loginDynamic, "force-dynamic");
  assert.equal(callbackDynamic, "force-dynamic");
});

test("validateAuthEnv rejects missing or unsafe configuration", () => {
  assert.throws(() => validateAuthEnv({}), /SESSION_SECRET/);
  assert.throws(
    () =>
      validateAuthEnv({
        SESSION_SECRET: "가".repeat(10),
        DOJO_SITE_URL: "http://localhost:3000",
        DOJO_E2E_AUTH: "1",
      }),
    /32 UTF-8 bytes/,
  );
  assert.doesNotThrow(() =>
    validateAuthEnv({
      SESSION_SECRET: "가".repeat(11),
      DOJO_SITE_URL: "http://localhost:3000",
      DOJO_E2E_AUTH: "1",
    }),
  );
  assert.throws(
    () =>
      validateAuthEnv({
        SESSION_SECRET: SECRET,
        DOJO_SITE_URL: "https://example.test/path",
        OSU_OAUTH_CLIENT_ID: "id",
        OSU_OAUTH_CLIENT_SECRET: "secret",
      }),
    /origin/,
  );
  assert.throws(
    () =>
      validateAuthEnv({
        SESSION_SECRET: SECRET,
        DOJO_SITE_URL: "https://example.test",
        DOJO_E2E_AUTH: "1",
      }),
    /loopback/,
  );
});

test("return_to preserves encoded query semantics and rejects unsafe paths", async () => {
  await withAuthEnv(() => {
    assert.equal(sanitizeReturnTo("/dan?q=100%25"), "/dan?q=100%25");
    assert.equal(sanitizeReturnTo("//evil.test"), "/");
    assert.equal(sanitizeReturnTo("/\\evil.test"), "/");
    assert.equal(sanitizeReturnTo("/bad\u0000path"), "/");
    assert.equal(sanitizeReturnTo(`/${"x".repeat(512)}`), "/");
  });
});

test("getSessionUser propagates request-scope errors", async () => {
  await assert.rejects(() => getSessionUser());
});

test("sessions store only hashes, rotate, expire, and revoke immediately", async () => {
  const temp = createTempDatabaseUrl();
  try {
    const { db } = await createTestDatabase(temp.url);
    db.$client
      .prepare(
        "INSERT INTO users (osu_user_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(77, "SessionPlayer", 1_000, 1_000);

    const first = await createSession(77, db, 10_000);
    const second = await createSession(77, db, 10_001);
    assert.notEqual(first, second);
    const stored = db.$client
      .prepare("SELECT token_hash AS tokenHash FROM sessions WHERE user_id = ? ORDER BY created_at")
      .all(77) as Array<{ tokenHash: string }>;
    assert.deepEqual(
      stored.map((row) => row.tokenHash),
      [hashToken(first), hashToken(second)],
    );
    assert.ok(stored.every((row) => row.tokenHash !== first && row.tokenHash !== second));
    assert.deepEqual(await getSessionUserFromToken(first, db, 10_002), {
      userId: 77,
      username: "SessionPlayer",
    });
    assert.equal(await getSessionUserFromToken("not-a-session", db, 10_002), null);

    db.$client
      .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
      .run(10_003, hashToken(first));
    assert.equal(await getSessionUserFromToken(first, db, 10_004), null);
    assert.equal(
      await getSessionUserFromToken(second, db, 10_001 + 7 * 24 * 60 * 60 * 1000),
      null,
    );
  } finally {
    temp.cleanup();
  }
});

test("OAuth provider exchange is form encoded and validates response shapes", async () => {
  await withNormalAuthEnv(async () => {
    let tokenRequest: RequestInit | undefined;
    const token = await exchangeCodeForToken("code-value", (async (_input, init) => {
      tokenRequest = init;
      return Response.json({ access_token: "access-value" });
    }) as typeof fetch);
    assert.equal(token, "access-value");
    assert.equal(
      (tokenRequest?.headers as Record<string, string>)["Content-Type"],
      "application/x-www-form-urlencoded",
    );
    assert.match(String(tokenRequest?.body), /grant_type=authorization_code/);
    assert.match(String(tokenRequest?.body), /redirect_uri=http%3A%2F%2Flocalhost%3A3000/);

    await assert.rejects(
      () =>
        exchangeCodeForToken(
          "code-value",
          (async () => Response.json({ access_token: "" })) as typeof fetch,
        ),
      /token response/,
    );
    await assert.rejects(
      () =>
        fetchOsuUser(
          "token",
          (async () => Response.json({ id: 1, username: "x".repeat(31) })) as typeof fetch,
        ),
      /user response/,
    );
  });
});

test("interactive OAuth calls fail 429 immediately without retrying", async () => {
  await withNormalAuthEnv(async () => {
    let tokenCalls = 0;
    let userCalls = 0;
    const throttled = () =>
      new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "Retry-After": "60" },
      });

    await assert.rejects(
      exchangeCodeForToken("code-value", (async () => {
        tokenCalls += 1;
        return throttled();
      }) as typeof fetch),
      /token response/,
    );
    await assert.rejects(
      fetchOsuUser("token", (async () => {
        userCalls += 1;
        return throttled();
      }) as typeof fetch),
      /user response/,
    );
    assert.equal(tokenCalls, 1);
    assert.equal(userCalls, 1);
  });
});

test("dummy OAuth completes the real state flow and logout revokes a copied cookie", async () => {
  await withAuthDatabase(async (db) => {
    const loginResponse = await login(
      new Request("http://127.0.0.1:3100/api/auth/osu/login?return_to=%2Fsettings"),
    );
    assert.equal(loginResponse.status, 302);
    const nonceCookie = extractCookie(loginResponse, "dojo_oauth_nonce");
    assert.ok(nonceCookie);
    const stateCount = db.$client
      .prepare("SELECT COUNT(*) AS count FROM oauth_states")
      .get() as { count: number };
    assert.equal(stateCount.count, 1);

    const authorizeResponse = dummyAuthorize(
      new Request(loginResponse.headers.get("location")!, {
        headers: { cookie: `dojo_oauth_nonce=${nonceCookie}` },
      }),
    );
    assert.equal(authorizeResponse.status, 302);

    const callbackUrl = authorizeResponse.headers.get("location")!;
    const callbackResponse = await callback(
      new Request(callbackUrl, {
        headers: { cookie: `dojo_oauth_nonce=${nonceCookie}` },
      }),
    );
    assert.equal(callbackResponse.status, 302);
    assert.equal(callbackResponse.headers.get("location"), "http://127.0.0.1:3100/settings");
    const sessionToken = extractCookie(callbackResponse, SESSION_COOKIE_NAME);
    assert.ok(sessionToken);
    assert.deepEqual(await getSessionUserFromToken(sessionToken, db), {
      userId: 77,
      username: "E2EPlayer",
    });
    assert.deepEqual(
      db.$client
        .prepare("SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?")
        .get(sessionToken) as { count: number },
      { count: 0 },
    );

    const reused = await callback(
      new Request(callbackUrl, {
        headers: { cookie: `dojo_oauth_nonce=${nonceCookie}` },
      }),
    );
    assert.equal(reused.status, 400);

    const secondLogin = await login(
      new Request("http://127.0.0.1:3100/api/auth/osu/login"),
    );
    const secondNonce = extractCookie(secondLogin, "dojo_oauth_nonce");
    assert.ok(secondNonce);
    const secondAuthorize = dummyAuthorize(
      new Request(secondLogin.headers.get("location")!, {
        headers: { cookie: `dojo_oauth_nonce=${secondNonce}` },
      }),
    );
    const futureUpdatedAt = Date.now() + 60_000;
    db.$client
      .prepare(
        "UPDATE users SET username = ?, updated_at = ? WHERE osu_user_id = ?",
      )
      .run("FutureName", futureUpdatedAt, 77);
    const secondCallback = await callback(
      new Request(secondAuthorize.headers.get("location")!, {
        headers: { cookie: `dojo_oauth_nonce=${secondNonce}` },
      }),
    );
    assert.equal(secondCallback.status, 302);
    assert.deepEqual(
      db.$client
        .prepare(
          "SELECT username, updated_at AS updatedAt FROM users WHERE osu_user_id = ?",
        )
        .get(77),
      { username: "FutureName", updatedAt: futureUpdatedAt },
    );

    const missingOrigin = await logout(
      new Request("http://127.0.0.1:3100/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      }),
    );
    assert.equal(missingOrigin.status, 403);

    const logoutResponse = await logout(
      new Request("http://127.0.0.1:3100/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          origin: "http://127.0.0.1:3100",
        },
      }),
    );
    assert.equal(logoutResponse.status, 204);
    assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal(await getSessionUserFromToken(sessionToken, db), null);
  });
});

test("dummy auth rejects non-loopback request hosts before writing state", async () => {
  await withAuthDatabase(async (db) => {
    const response = await login(
      new Request("http://example.test/api/auth/osu/login"),
    );
    assert.equal(response.status, 403);
    const row = db.$client
      .prepare("SELECT COUNT(*) AS count FROM oauth_states")
      .get() as { count: number };
    assert.equal(row.count, 0);
    assert.equal(response.headers.get("set-cookie"), null);
  });
});

async function withAuthDatabase(
  callbackFn: (db: Awaited<ReturnType<typeof createTestDatabase>>["db"]) => Promise<void>,
) {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;
  try {
    await withAuthEnv(async () => {
      process.env["DATABASE_URL"] = temp.url;
      const bundle = await createTestDatabase(temp.url);
      globalThis.__osuDojoDatabaseBundle = bundle;
      await callbackFn(bundle.db);
    });
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
}

function withAuthEnv<T>(callbackFn: () => T | Promise<T>): Promise<T> {
  return withEnvironment(
    {
      SESSION_SECRET: SECRET,
      DOJO_SITE_URL: "http://127.0.0.1:3100",
      DOJO_E2E_AUTH: "1",
      OSU_OAUTH_CLIENT_ID: undefined,
      OSU_OAUTH_CLIENT_SECRET: undefined,
    },
    callbackFn,
  );
}

function withNormalAuthEnv<T>(callbackFn: () => T | Promise<T>): Promise<T> {
  return withEnvironment(
    {
      SESSION_SECRET: SECRET,
      DOJO_SITE_URL: "http://localhost:3000",
      DOJO_E2E_AUTH: undefined,
      OSU_OAUTH_CLIENT_ID: "client-id",
      OSU_OAUTH_CLIENT_SECRET: "client-secret",
    },
    callbackFn,
  );
}

async function withEnvironment<T>(
  values: Record<(typeof AUTH_KEYS)[number], string | undefined>,
  callbackFn: () => T | Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(AUTH_KEYS.map((key) => [key, process.env[key]]));
  for (const key of AUTH_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await callbackFn();
  } finally {
    for (const key of AUTH_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function extractCookie(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? "";
  return new RegExp(`(?:^|,\\s*)${name}=([^;]+)`).exec(header)?.[1] ?? null;
}
