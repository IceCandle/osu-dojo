import test from "node:test";
import assert from "node:assert/strict";
import {
  FetchTransportError,
  fetchLatestPlayerMapScore,
  ScoreApiTimeoutError,
} from "@/bot/osuApi";
import { parseMatchEventWindow } from "@/lib/osu/matches";

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

function successWindow() {
  return parseMatchEventWindow({
    first_event_id: 1,
    latest_event_id: 1,
    events: [
      {
        id: 1,
        game: {
          id: 3,
          beatmap_id: 259,
          end_time: "2026-07-24T00:00:00Z",
          mods: [],
          scores: [
            {
              user_id: 42,
              legacy_total_score: 910000,
              max_combo: 800,
              passed: true,
              statistics: { great: 1000, ok: 40, meh: 4, miss: 2 },
              mods: [],
            },
          ],
        },
      },
    ],
  });
}

test("score retry applies the one-second run-critical delay floor", async () => {
  const clock = createClock();
  let calls = 0;
  const result = await fetchLatestPlayerMapScore({
    beatmapId: 259,
    userId: 42,
    processedGameIds: new Set<number>(),
    deadlineDurationMs: 5_000,
    retryDelayMs: 10,
    retryDelayMinMs: 1_000,
    retryDelayMaxMs: 2_000,
    random: () => 0,
    now: clock.now,
    sleep: clock.sleep,
    fetchMatchWindow: async () => {
      calls += 1;
      if (calls < 3) {
        throw new FetchTransportError("HTTP 500", true);
      }
      return successWindow();
    },
  });

  assert.equal(result.gameId, 3);
  assert.deepEqual(clock.sleeps, [1_000, 1_000]);
});

test("score retry never sleeps past the operation deadline", async () => {
  const clock = createClock();
  await assert.rejects(
    fetchLatestPlayerMapScore({
      beatmapId: 259,
      userId: 42,
      processedGameIds: new Set<number>(),
      deadlineDurationMs: 1_000,
      retryDelayMs: 10,
      retryDelayMinMs: 1_000,
      random: () => 1,
      now: clock.now,
      sleep: clock.sleep,
      fetchMatchWindow: async () => {
        clock.advance(10);
        throw new FetchTransportError("HTTP 500", true);
      },
    }),
    ScoreApiTimeoutError,
  );

  assert.deepEqual(clock.sleeps, []);
});

test("score retry backoff uses full-jitter exponential caps", async () => {
  const clock = createClock();
  let calls = 0;
  const result = await fetchLatestPlayerMapScore({
    beatmapId: 259,
    userId: 42,
    processedGameIds: new Set<number>(),
    deadlineDurationMs: 1_000,
    retryDelayMs: 10,
    retryDelayMinMs: 0,
    retryDelayMaxMs: 50,
    random: () => 1,
    now: clock.now,
    sleep: clock.sleep,
    fetchMatchWindow: async () => {
      calls += 1;
      if (calls < 5) {
        throw new FetchTransportError("HTTP 429", true);
      }
      return successWindow();
    },
  });

  assert.equal(result.gameId, 3);
  assert.deepEqual(clock.sleeps, [10, 20, 40, 50]);
});

test("score retry backoff scales each sleep by injected jitter", async () => {
  const clock = createClock();
  let calls = 0;
  await fetchLatestPlayerMapScore({
    beatmapId: 259,
    userId: 42,
    processedGameIds: new Set<number>(),
    deadlineDurationMs: 1_000,
    retryDelayMs: 10,
    retryDelayMinMs: 0,
    retryDelayMaxMs: 50,
    random: () => 0.5,
    now: clock.now,
    sleep: clock.sleep,
    fetchMatchWindow: async () => {
      calls += 1;
      if (calls < 5) {
        throw new FetchTransportError("HTTP 500", true);
      }
      return successWindow();
    },
  });

  assert.deepEqual(clock.sleeps, [5, 10, 20, 25]);
});

test("score retry backoff allows zero jitter", async () => {
  const clock = createClock();
  let calls = 0;
  await assert.rejects(
    fetchLatestPlayerMapScore({
      beatmapId: 259,
      userId: 42,
      processedGameIds: new Set<number>(),
      deadlineDurationMs: 30,
      retryDelayMs: 10,
      retryDelayMinMs: 0,
      random: () => 0,
      now: clock.now,
      sleep: clock.sleep,
      fetchMatchWindow: async () => {
        calls += 1;
        clock.advance(10);
        throw new FetchTransportError("HTTP 500", true);
      },
    }),
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
