import test from "node:test";
import assert from "node:assert/strict";
import {
  FetchTransportError,
  fetchLatestPlayerMapScore,
  NoGameInApiError,
  NoPlayerScoreInGameError,
  ScoreApiTimeoutError,
} from "@/bot/osuApi";
import { OsuApiDeadlineError } from "@/lib/osu/client";
import {
  parseMatchEventWindow,
  type MatchWindowFetcher,
} from "@/lib/osu/matches";
import { OsuTokenError } from "@/lib/osu/token";

function createClock() {
  let currentTime = 0;
  return {
    now: () => currentTime,
    sleep: async (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

function createScore(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 42,
    legacy_total_score: 910000,
    max_combo: 800,
    passed: true,
    statistics: { great: 1000, ok: 40, meh: 4, miss: 2 },
    mods: [],
    ...overrides,
  };
}

function createGame(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    beatmap_id: 259,
    end_time: "2026-07-24T00:00:00Z",
    mods: [],
    scores: [createScore()],
    ...overrides,
  };
}

function createMatchWindow(games: unknown[]) {
  return parseMatchEventWindow({
    first_event_id: 1,
    latest_event_id: Math.max(1, games.length),
    events: games.map((game, index) => ({
      id: index + 1,
      game,
    })),
  });
}

function createOptions(
  clock: ReturnType<typeof createClock>,
  fetchMatchWindow: MatchWindowFetcher,
  overrides: Partial<{
    deadlineDurationMs: number;
    retryDelayMs: number;
    retryDelayMinMs: number;
  }> = {},
) {
  return {
    beatmapId: 259,
    userId: 42,
    processedGameIds: new Set<number>(),
    deadlineDurationMs: overrides.deadlineDurationMs ?? 1_500,
    retryDelayMs: overrides.retryDelayMs ?? 10,
    retryDelayMinMs: overrides.retryDelayMinMs ?? 1_000,
    fetchMatchWindow,
    now: clock.now,
    random: () => 1,
    sleep: clock.sleep,
  };
}

test("score fetcher preserves the existing normalized score contract", async () => {
  const clock = createClock();
  const result = await fetchLatestPlayerMapScore(
    createOptions(clock, async () =>
      createMatchWindow([
        createGame({
          mods: [{ acronym: "HR" }],
          scores: [
            createScore({
              mods: [{ acronym: "HR" }, { acronym: "HD" }],
            }),
          ],
        }),
      ]),
    ),
  );

  assert.deepEqual(
    {
      gameId: result.gameId,
      beatmapId: result.beatmapId,
      userId: result.userId,
      score: result.score,
      playerEnabledMods: result.playerEnabledMods,
      globalGameMods: result.globalGameMods,
      maxCombo: result.maxCombo,
      count300: result.count300,
      count100: result.count100,
      count50: result.count50,
      countMiss: result.countMiss,
      passed: result.passed,
    },
    {
      gameId: 2,
      beatmapId: 259,
      userId: 42,
      score: 910000,
      playerEnabledMods: 8,
      globalGameMods: 16,
      maxCombo: 800,
      count300: 1000,
      count100: 40,
      count50: 4,
      countMiss: 2,
      passed: true,
    },
  );
});

test("score fetcher ignores processed games", async () => {
  const clock = createClock();
  const options = createOptions(clock, async () =>
    createMatchWindow([createGame()]),
  );
  options.processedGameIds.add(2);

  await assert.rejects(fetchLatestPlayerMapScore(options), NoGameInApiError);
});

test("score fetcher can recover after one transient transport error", async () => {
  const clock = createClock();
  let calls = 0;
  const result = await fetchLatestPlayerMapScore(
    createOptions(clock, async () => {
      calls += 1;
      if (calls === 1) {
        throw new FetchTransportError("temporary 500", true);
      }
      return createMatchWindow([createGame()]);
    }),
  );

  assert.equal(result.gameId, 2);
  assert.equal(calls, 2);
});

test("score fetcher does not retry non-retryable transport errors", async () => {
  const clock = createClock();
  let calls = 0;
  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        calls += 1;
        throw new FetchTransportError("HTTP 404", false);
      }),
    ),
    FetchTransportError,
  );
  assert.equal(calls, 1);
});

test("score fetcher does not retry non-retryable token errors", async () => {
  const clock = createClock();
  let calls = 0;
  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        calls += 1;
        throw new OsuTokenError("invalid credentials", { retryable: false });
      }),
    ),
    OsuTokenError,
  );
  assert.equal(calls, 1);
});

test("score fetcher preserves an unmappable mod without aborting", async () => {
  const clock = createClock();
  let calls = 0;
  const result = await fetchLatestPlayerMapScore(
    createOptions(clock, async () => {
      calls += 1;
      return createMatchWindow([
        createGame({
          scores: [createScore({ mods: [{ acronym: "FUTURE" }] })],
        }),
      ]);
    }),
  );

  assert.equal(calls, 1);
  assert.equal(result.playerEnabledMods, 0);
  assert.deepEqual(result.unknownModAcronyms, {
    global: [],
    player: ["FUTURE"],
  });
});

test("score fetcher throws NoGameInApiError when the game never appears", async () => {
  const clock = createClock();
  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => createMatchWindow([])),
    ),
    (error) => {
      assert.ok(error instanceof NoGameInApiError);
      assert.equal(error.beatmapId, 259);
      assert.equal(error.attempts, 2);
      return true;
    },
  );
});

test("score fetcher keeps game-without-player as the strongest evidence", async () => {
  const clock = createClock();
  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () =>
        createMatchWindow([
          createGame({
            end_time: null,
            scores: [createScore({ user_id: 99 })],
          }),
        ]),
      ),
    ),
    (error) => {
      assert.ok(error instanceof NoPlayerScoreInGameError);
      assert.equal(error.gameId, 2);
      assert.equal(error.userId, 42);
      return true;
    },
  );
});

test("score fetcher revisits a published game while its player score is missing", async () => {
  const clock = createClock();
  const cursors: unknown[] = [];
  let calls = 0;
  const result = await fetchLatestPlayerMapScore({
    ...createOptions(clock, async (cursor) => {
      cursors.push(cursor);
      calls += 1;
      return createMatchWindow([
        createGame({
          scores: [
            createScore({ user_id: calls === 1 ? 99 : 42 }),
          ],
        }),
      ]);
    }),
  });

  assert.equal(result.userId, 42);
  assert.deepEqual(cursors, [{}, {}]);
});

test("score fetcher revisits an in-progress event after it completes", async () => {
  const clock = createClock();
  const cursors: unknown[] = [];
  let calls = 0;
  const result = await fetchLatestPlayerMapScore(
    createOptions(clock, async (cursor) => {
      cursors.push(cursor);
      calls += 1;
      if (cursor.after !== undefined) {
        return createMatchWindow([]);
      }
      return createMatchWindow([
        createGame(
          calls === 1
            ? { end_time: null, scores: [] }
            : {},
        ),
      ]);
    }),
  );

  assert.equal(result.gameId, 2);
  assert.deepEqual(cursors, [{}, {}]);
});

test("score fetcher maps an exhausted request deadline to ScoreApiTimeoutError", async () => {
  const clock = createClock();
  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        throw new OsuApiDeadlineError();
      }),
    ),
    (error) => {
      assert.ok(error instanceof ScoreApiTimeoutError);
      assert.ok(error.lastUnderlyingError instanceof OsuApiDeadlineError);
      return true;
    },
  );
});

test("a request deadline outranks earlier no-game evidence", async () => {
  const clock = createClock();
  let calls = 0;
  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        calls += 1;
        if (calls === 1) {
          return createMatchWindow([]);
        }
        throw new OsuApiDeadlineError();
      }),
    ),
    ScoreApiTimeoutError,
  );
});

test("a request deadline outranks earlier game-without-player evidence", async () => {
  const clock = createClock();
  let calls = 0;
  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        calls += 1;
        if (calls === 1) {
          return createMatchWindow([
            createGame({ scores: [createScore({ user_id: 99 })] }),
          ]);
        }
        throw new OsuApiDeadlineError();
      }),
    ),
    ScoreApiTimeoutError,
  );
});

test("score fetcher rejects a retry maximum below its minimum", async () => {
  const clock = createClock();
  await assert.rejects(
    fetchLatestPlayerMapScore({
      ...createOptions(clock, async () => createMatchWindow([])),
      retryDelayMinMs: 1_000,
      retryDelayMaxMs: 999,
    }),
    /retryDelayMaxMs must be greater than or equal to retryDelayMinMs/i,
  );
});
