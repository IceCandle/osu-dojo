import test from "node:test";
import assert from "node:assert/strict";
import {
  createOsuApiClient,
  FetchTransportError,
  InProcessRateLimiter,
  OSU_API_RESPONSE_VERSION,
  OsuApiDeadlineError,
  parseRetryAfter,
} from "@/lib/osu/client";

function createClock(initial = 0) {
  let current = initial;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
      current += milliseconds;
    },
    sleeps,
  };
}

function limiters(intervalMs = 0) {
  return {
    runCritical: new InProcessRateLimiter(intervalMs),
    metadata: new InProcessRateLimiter(intervalMs),
  };
}

test("v2 client pins the response version and retries one 401 with a fresh token", async () => {
  const clock = createClock();
  const tokenCalls: boolean[] = [];
  const authorizations: string[] = [];
  let requests = 0;
  const client = createOsuApiClient({
    now: clock.now,
    sleep: clock.sleep,
    rateLimiters: limiters(),
    tokenProvider: {
      async getAccessToken(options) {
        tokenCalls.push(options?.forceRefresh ?? false);
        return options?.forceRefresh ? "fresh" : "stale";
      },
    },
    fetchImpl: async (_input, init) => {
      requests += 1;
      const headers = new Headers(init?.headers);
      authorizations.push(headers.get("authorization") ?? "");
      assert.equal(
        headers.get("x-api-version"),
        String(OSU_API_RESPONSE_VERSION),
      );
      return requests === 1
        ? new Response("", { status: 401 })
        : new Response(JSON.stringify({ ok: true }));
    },
  });

  assert.deepEqual(
    await client.requestJson("/api/v2/test", {
      rateLimit: "runCritical",
      deadline: 10_000,
      perCallTimeoutMs: 1_000,
    }),
    { ok: true },
  );
  assert.deepEqual(tokenCalls, [false, true]);
  assert.deepEqual(authorizations, ["Bearer stale", "Bearer fresh"]);
});

test("v2 client honors numeric and HTTP-date Retry-After values", async () => {
  assert.equal(parseRetryAfter("2", 0), 2_000);
  assert.equal(
    parseRetryAfter("Thu, 01 Jan 1970 00:00:03 GMT", 1_000),
    2_000,
  );

  const clock = createClock();
  let calls = 0;
  const client = createOsuApiClient({
    now: clock.now,
    sleep: clock.sleep,
    rateLimiters: limiters(),
    random: () => 0,
    tokenProvider: { async getAccessToken() { return "token"; } },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : new Response(JSON.stringify({ ok: true }));
    },
  });
  await client.requestJson("/api/v2/test", {
    rateLimit: "runCritical",
    deadline: 5_000,
    perCallTimeoutMs: 1_000,
  });
  assert.deepEqual(clock.sleeps, [2_000]);
});

test("v2 client refuses Retry-After and limiter waits beyond the deadline", async () => {
  const retryClock = createClock();
  const retryClient = createOsuApiClient({
    now: retryClock.now,
    sleep: retryClock.sleep,
    rateLimiters: limiters(),
    tokenProvider: { async getAccessToken() { return "token"; } },
    fetchImpl: async () =>
      new Response("", { status: 429, headers: { "Retry-After": "5" } }),
  });
  await assert.rejects(
    retryClient.requestJson("/api/v2/test", {
      rateLimit: "runCritical",
      deadline: 1_000,
      perCallTimeoutMs: 500,
    }),
    OsuApiDeadlineError,
  );
  assert.deepEqual(retryClock.sleeps, []);

  const limiterClock = createClock();
  const sharedLimiters = limiters(2_000);
  const limiterClient = createOsuApiClient({
    now: limiterClock.now,
    sleep: limiterClock.sleep,
    rateLimiters: sharedLimiters,
    tokenProvider: { async getAccessToken() { return "token"; } },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
  });
  await limiterClient.requestJson("/api/v2/test", {
    rateLimit: "runCritical",
    deadline: 5_000,
    perCallTimeoutMs: 500,
  });
  await assert.rejects(
    limiterClient.requestJson("/api/v2/test", {
      rateLimit: "runCritical",
      deadline: 1_000,
      perCallTimeoutMs: 500,
    }),
    OsuApiDeadlineError,
  );
});

test("rate limiter queue time is bounded by each caller deadline", async () => {
  const limiter = new InProcessRateLimiter(1_000);
  const now = Date.now;
  let releaseBlockedSleep!: () => void;
  let sleepCalls = 0;
  const sleep = async () => {
    sleepCalls += 1;
    if (sleepCalls === 1) {
      await new Promise<void>((resolve) => {
        releaseBlockedSleep = resolve;
      });
    }
  };

  await limiter.acquire({ deadline: now() + 5_000, now, sleep });
  const blocked = limiter.acquire({ deadline: now() + 5_000, now, sleep });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(
    limiter.acquire({ deadline: now() + 10, now, sleep }),
    OsuApiDeadlineError,
  );
  releaseBlockedSleep();
  await blocked;
  await limiter.acquire({ deadline: now() + 5_000, now, sleep });
});

test("clients created with different clocks do not share implicit limiters", async () => {
  const firstClock = createClock(1_000_000);
  const secondClock = createClock(0);
  const createClient = (clock: ReturnType<typeof createClock>) =>
    createOsuApiClient({
      now: clock.now,
      sleep: clock.sleep,
      tokenProvider: { async getAccessToken() { return "token"; } },
      fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
    });

  await createClient(firstClock).requestJson("/api/v2/test", {
    rateLimit: "runCritical",
    deadline: 1_010_000,
    perCallTimeoutMs: 100,
  });
  await createClient(secondClock).requestJson("/api/v2/test", {
    rateLimit: "runCritical",
    deadline: 10_000,
    perCallTimeoutMs: 100,
  });

  assert.deepEqual(secondClock.sleeps, []);
});

test("token acquisition is bounded by the operation deadline", async () => {
  const client = createOsuApiClient({
    rateLimiters: limiters(),
    tokenProvider: {
      async getAccessToken() {
        return new Promise<string>(() => {});
      },
    },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
  });

  await assert.rejects(
    client.requestJson("/api/v2/test", {
      rateLimit: "runCritical",
      deadline: Date.now() + 10,
      perCallTimeoutMs: 100,
    }),
    OsuApiDeadlineError,
  );
});

test("v2 client aborts a timed-out request and does not retry permanent 4xx", async () => {
  const timeoutClient = createOsuApiClient({
    rateLimiters: limiters(),
    random: () => 1,
    tokenProvider: { async getAccessToken() { return "token"; } },
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  });
  await assert.rejects(
    timeoutClient.requestJson("/api/v2/test", {
      rateLimit: "runCritical",
      deadline: Date.now() + 20,
      perCallTimeoutMs: 5,
    }),
    OsuApiDeadlineError,
  );

  let calls = 0;
  const permanentClient = createOsuApiClient({
    rateLimiters: limiters(),
    tokenProvider: { async getAccessToken() { return "token"; } },
    fetchImpl: async () => {
      calls += 1;
      return new Response("", { status: 404 });
    },
  });
  await assert.rejects(
    permanentClient.requestJson("/api/v2/test", {
      rateLimit: "runCritical",
      deadline: Date.now() + 1_000,
      perCallTimeoutMs: 100,
    }),
    (error) => {
      assert.ok(error instanceof FetchTransportError);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});
