import test from "node:test";
import assert from "node:assert/strict";
import {
  FetchTransportError,
  fetchLatestPlayerMapScore,
  ScoreApiTimeoutError,
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

function successPayload() {
  return {
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
  };
}

test("score retry applies the one-second run-critical delay floor", async () => {
  const clock = createClock();
  let calls = 0;
  const result = await fetchLatestPlayerMapScore({
    beatmapId: 259,
    userId: 42,
    processedGameIds: new Set<number>(),
    deadlineDurationMs: 5_000,
    perCallTimeoutMs: 100,
    retryDelayMs: 10,
    retryDelayMinMs: 1_000,
    retryDelayMaxMs: 50,
    random: () => 0,
    now: clock.now,
    sleep: clock.sleep,
    fetchMatchWindow: async () => {
      calls += 1;
      if (calls < 3) {
        throw new FetchTransportError("HTTP 500", true);
      }
      return successPayload();
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
      perCallTimeoutMs: 100,
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
