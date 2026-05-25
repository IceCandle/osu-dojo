import test from "node:test";
import assert from "node:assert/strict";
import {
  FetchTransportError,
  ScoreApiTimeoutError,
  fetchLatestPlayerMapScore,
} from "@/bot/osuApi";

function createClock() {
  let currentTime = 0;
  const sleeps: number[] = [];

  return {
    now: () => currentTime,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
    },
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
    sleeps,
  };
}

function createMatchPayload() {
  return JSON.stringify({
    games: [
      {
        game_id: "3",
        beatmap_id: "259",
        scores: [
          {
            user_id: "42",
            score: "910000",
            maxcombo: "800",
            count300: "1000",
            count100: "40",
            count50: "4",
            countmiss: "2",
            pass: "1",
          },
        ],
      },
    ],
  });
}

function createOptions(
  clock: ReturnType<typeof createClock>,
  fetchMatch: (signal: AbortSignal) => Promise<string>,
  overrides: Partial<{
    totalBudgetMs: number;
    retryDelayMs: number;
    retryBackoffFactor: number;
    retryDelayMaxMs: number;
    random: () => number;
  }> = {},
) {
  return {
    beatmapId: 259,
    userId: 42,
    processedGameIds: new Set<number>(),
    totalBudgetMs: overrides.totalBudgetMs ?? 1_000,
    perCallTimeoutMs: 0,
    retryDelayMs: overrides.retryDelayMs ?? 10,
    retryBackoffFactor: overrides.retryBackoffFactor,
    retryDelayMaxMs: overrides.retryDelayMaxMs,
    fetchMatch,
    now: clock.now,
    random: overrides.random ?? (() => 1),
    sleep: clock.sleep,
  };
}

test("score retry backoff uses full-jitter exponential caps", async () => {
  const clock = createClock();
  let calls = 0;

  const result = await fetchLatestPlayerMapScore(
    createOptions(
      clock,
      async () => {
        calls += 1;
        if (calls < 5) {
          throw new FetchTransportError("HTTP 429", true);
        }

        return createMatchPayload();
      },
      { retryDelayMaxMs: 50 },
    ),
  );

  assert.equal(result.gameId, 3);
  assert.equal(calls, 5);
  assert.deepEqual(clock.sleeps, [10, 20, 40, 50]);
});

test("score retry backoff scales each sleep by injected jitter", async () => {
  const clock = createClock();
  let calls = 0;

  await fetchLatestPlayerMapScore(
    createOptions(
      clock,
      async () => {
        calls += 1;
        if (calls < 5) {
          throw new FetchTransportError("HTTP 500", true);
        }

        return createMatchPayload();
      },
      { retryDelayMaxMs: 50, random: () => 0.5 },
    ),
  );

  assert.deepEqual(clock.sleeps, [5, 10, 20, 25]);
});

test("score retry backoff allows zero jitter without spending sleep budget", async () => {
  const clock = createClock();
  let calls = 0;

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(
        clock,
        async () => {
          calls += 1;
          clock.advance(10);
          throw new FetchTransportError("HTTP 500", true);
        },
        { totalBudgetMs: 30, random: () => 0 },
      ),
    ),
    (error) => {
      assert.ok(error instanceof ScoreApiTimeoutError);
      assert.equal(error.elapsedMs, 30);
      assert.equal(error.attempts, 3);
      return true;
    },
  );

  assert.equal(calls, 3);
  assert.deepEqual(clock.sleeps, [0, 0]);
});

test("score retry recovers after retryable throttled responses", async () => {
  const clock = createClock();
  const errors = ["HTTP 429", "HTTP 500"];
  let calls = 0;

  const result = await fetchLatestPlayerMapScore(
    createOptions(
      clock,
      async () => {
        calls += 1;
        const error = errors.shift();
        if (error) {
          throw new FetchTransportError(error, true);
        }

        return createMatchPayload();
      },
      { totalBudgetMs: 100, random: () => 0.5 },
    ),
  );

  assert.equal(result.gameId, 3);
  assert.equal(calls, 3);
  assert.equal(clock.sleeps.reduce((sum, value) => sum + value, 0) <= 100, true);
});

test("score retry stops retryable transport errors before sleep exceeds budget", async () => {
  const clock = createClock();

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(
        clock,
        async () => {
          throw new FetchTransportError("HTTP 500", true);
        },
        { totalBudgetMs: 50, retryDelayMs: 20 },
      ),
    ),
    (error) => {
      assert.ok(error instanceof ScoreApiTimeoutError);
      assert.equal(error.attempts, 2);
      assert.equal(error.elapsedMs, 20);
      return true;
    },
  );

  assert.equal(clock.sleeps.reduce((sum, value) => sum + value, 0) <= 50, true);
});
