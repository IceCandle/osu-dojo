import test from "node:test";
import assert from "node:assert/strict";
import {
  createOsuTokenProvider,
  OsuTokenError,
} from "@/lib/osu/token";

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return new Response(
    JSON.stringify({ access_token: accessToken, expires_in: expiresIn }),
    { headers: { "content-type": "application/json" } },
  );
}

test("token provider caches a token until its refresh skew", async () => {
  let now = 0;
  let calls = 0;
  const provider = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse(`token-${calls}`, 120);
    },
  });

  assert.equal(await provider.getAccessToken(), "token-1");
  assert.equal(await provider.getAccessToken(), "token-1");
  now = 61_000;
  assert.equal(await provider.getAccessToken(), "token-2");
  assert.equal(calls, 2);
});

test("token provider shares a concurrent token request", async () => {
  let resolve!: (response: Response) => void;
  let calls = 0;
  const provider = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    fetchImpl: async (_input, init) => {
      calls += 1;
      assert.match(String(init?.body), /grant_type=client_credentials/);
      assert.match(String(init?.body), /scope=public/);
      return new Promise<Response>((promiseResolve) => {
        resolve = promiseResolve;
      });
    },
  });

  const first = provider.getAccessToken();
  const second = provider.getAccessToken();
  resolve(tokenResponse("shared"));
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  assert.equal(calls, 1);
});

test("token provider supports a forced refresh after a consumer receives 401", async () => {
  let calls = 0;
  const provider = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse(`token-${calls}`);
    },
  });
  assert.equal(await provider.getAccessToken(), "token-1");
  assert.equal(
    await provider.getAccessToken({ forceRefresh: true }),
    "token-2",
  );
});

test("forced refresh does not reuse a token request that was already in flight", async () => {
  const resolvers: Array<(response: Response) => void> = [];
  const provider = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    fetchImpl: async () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      }),
  });

  const ordinary = provider.getAccessToken();
  const forced = provider.getAccessToken({ forceRefresh: true });
  assert.equal(resolvers.length, 1);
  resolvers[0]!(tokenResponse("stale"));
  assert.equal(await ordinary, "stale");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolvers.length, 2);
  resolvers[1]!(tokenResponse("fresh"));
  assert.equal(await forced, "fresh");
});

test("token provider classifies endpoint failures", async () => {
  const retryable = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  const permanent = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    fetchImpl: async () => new Response("", { status: 400 }),
  });

  await assert.rejects(retryable.getAccessToken(), (error) => {
    assert.ok(error instanceof OsuTokenError);
    assert.equal(error.retryable, true);
    return true;
  });
  await assert.rejects(permanent.getAccessToken(), (error) => {
    assert.ok(error instanceof OsuTokenError);
    assert.equal(error.retryable, false);
    return true;
  });
});

test("token fetch timeout clears in-flight state for the next attempt", async () => {
  let calls = 0;
  const provider = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    requestTimeoutMs: 5,
    fetchImpl: async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return tokenResponse("recovered");
    },
  });

  await assert.rejects(provider.getAccessToken(), (error) => {
    assert.ok(error instanceof OsuTokenError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /timed out/i);
    return true;
  });
  assert.equal(await provider.getAccessToken(), "recovered");
  assert.equal(calls, 2);
});

test("token timeout also bounds reading the JSON response body", async () => {
  let calls = 0;
  const provider = createOsuTokenProvider({
    clientId: "1",
    clientSecret: "secret",
    requestTimeoutMs: 5,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const response = new Response();
        response.json = async () => new Promise<never>(() => {});
        return response;
      }
      return tokenResponse("after-body-timeout");
    },
  });

  await assert.rejects(provider.getAccessToken(), OsuTokenError);
  assert.equal(await provider.getAccessToken(), "after-body-timeout");
  assert.equal(calls, 2);
});
