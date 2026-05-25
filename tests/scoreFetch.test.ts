import test from "node:test";
import assert from "node:assert/strict";
import {
  FetchTransportError,
  fetchLatestPlayerMapScore,
  NoGameInApiError,
  NoPlayerScoreInGameError,
  ScoreApiTimeoutError,
} from "@/bot/osuApi";

function createClock() {
  let currentTime = 0;

  return {
    now: () => currentTime,
    sleep: async (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function waitForTimer() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createScore(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "42",
    score: "910000",
    maxcombo: "800",
    count300: "1000",
    count100: "40",
    count50: "4",
    countmiss: "2",
    pass: "1",
    ...overrides,
  };
}

function createMatchPayload(games: unknown[]) {
  return JSON.stringify({ games });
}

function createGame(overrides: Record<string, unknown> = {}) {
  return {
    game_id: "2",
    beatmap_id: "259",
    scores: [createScore()],
    ...overrides,
  };
}

function createOptions(
  clock: ReturnType<typeof createClock>,
  fetchMatch: (signal: AbortSignal) => Promise<string>,
  overrides: Partial<{
    totalBudgetMs: number;
    perCallTimeoutMs: number;
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
    totalBudgetMs: overrides.totalBudgetMs ?? 20,
    perCallTimeoutMs: overrides.perCallTimeoutMs ?? 0,
    retryDelayMs: overrides.retryDelayMs ?? 10,
    retryBackoffFactor: overrides.retryBackoffFactor,
    retryDelayMaxMs: overrides.retryDelayMaxMs,
    fetchMatch,
    now: clock.now,
    random: overrides.random ?? (() => 1),
    sleep: clock.sleep,
  };
}

test("score fetcher returns the target player's score from the latest matching game", async () => {
  const clock = createClock();
  const result = await fetchLatestPlayerMapScore(
    createOptions(clock, async () =>
      createMatchPayload([
        createGame({ game_id: "1", beatmap_id: "100" }),
        createGame({ game_id: "2", beatmap_id: "259" }),
      ]),
    ),
  );

  assert.equal(result.gameId, 2);
  assert.equal(result.beatmapId, 259);
  assert.equal(result.userId, 42);
  assert.equal(result.score, 910000);
  assert.equal(result.playerEnabledMods, 0);
  assert.equal(result.globalGameMods, 0);
  assert.equal(result.passed, true);
});

test("score fetcher parses game and player mod bitmasks", async () => {
  const clock = createClock();
  const result = await fetchLatestPlayerMapScore(
    createOptions(clock, async () =>
      createMatchPayload([
        createGame({
          mods: "16",
          scores: [createScore({ enabled_mods: "8" })],
        }),
      ]),
    ),
  );

  assert.equal(result.globalGameMods, 16);
  assert.equal(result.playerEnabledMods, 8);
});

test("score fetcher defaults missing, null, and zero mod bitmasks to zero", async () => {
  const clock = createClock();
  const missing = await fetchLatestPlayerMapScore(
    createOptions(clock, async () =>
      createMatchPayload([
        createGame({
          scores: [createScore()],
        }),
      ]),
    ),
  );
  const nullMods = await fetchLatestPlayerMapScore(
    createOptions(clock, async () =>
      createMatchPayload([
        createGame({
          game_id: "3",
          mods: null,
          scores: [createScore({ enabled_mods: null })],
        }),
      ]),
    ),
  );
  const zeroMods = await fetchLatestPlayerMapScore(
    createOptions(clock, async () =>
      createMatchPayload([
        createGame({
          game_id: "4",
          mods: "0",
          scores: [createScore({ enabled_mods: "0" })],
        }),
      ]),
    ),
  );

  assert.equal(missing.globalGameMods, 0);
  assert.equal(missing.playerEnabledMods, 0);
  assert.equal(nullMods.globalGameMods, 0);
  assert.equal(nullMods.playerEnabledMods, 0);
  assert.equal(zeroMods.globalGameMods, 0);
  assert.equal(zeroMods.playerEnabledMods, 0);
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

      return createMatchPayload([createGame()]);
    }),
  );

  assert.equal(result.gameId, 2);
  assert.equal(calls, 2);
});

test("score fetcher throws NoGameInApiError when the game never appears", async () => {
  const clock = createClock();

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => createMatchPayload([])),
    ),
    (error) => {
      assert.ok(error instanceof NoGameInApiError);
      assert.equal(error.beatmapId, 259);
      assert.equal(error.attempts, 2);
      assert.equal(error.elapsedMs, 10);
      return true;
    },
  );
});

test("score fetcher keeps game-without-player as the strongest evidence", async () => {
  const clock = createClock();
  let calls = 0;

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        calls += 1;
        if (calls === 1) {
          return createMatchPayload([
            createGame({
              game_id: "7",
              scores: [createScore({ user_id: "99" })],
            }),
          ]);
        }

        return new Promise<string>(() => {});
      }),
    ),
    (error) => {
      assert.ok(error instanceof NoPlayerScoreInGameError);
      assert.equal(error.gameId, 7);
      assert.equal(error.userId, 42);
      assert.equal(error.attempts, 2);
      return true;
    },
  );
});

test("score fetcher throws ScoreApiTimeoutError when every call times out", async () => {
  const clock = createClock();

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async (signal) => {
        return await new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    ),
    (error) => {
      assert.ok(error instanceof ScoreApiTimeoutError);
      assert.ok(error.lastUnderlyingError instanceof Error);
      assert.equal(error.lastUnderlyingError.name, "PerCallTimeoutError");
      return true;
    },
  );
});

test("score fetcher gates the next attempt until an aborted fetch settles", async () => {
  const firstFetch = createDeferred<string>();
  const graceSleep = createDeferred<void>();
  const clock = {
    now: () => 0,
    sleep: async (milliseconds: number) => {
      if (milliseconds === 100) {
        return graceSleep.promise;
      }
    },
  };
  let calls = 0;

  const resultPromise = fetchLatestPlayerMapScore({
    beatmapId: 259,
    userId: 42,
    processedGameIds: new Set<number>(),
    totalBudgetMs: 1_000,
    perCallTimeoutMs: 0,
    retryDelayMs: 10,
    now: clock.now,
    sleep: clock.sleep,
    fetchMatch: async () => {
      calls += 1;
      if (calls === 1) {
        return firstFetch.promise;
      }

      return createMatchPayload([createGame()]);
    },
  });

  await waitForTimer();
  assert.equal(calls, 1);

  firstFetch.reject(new DOMException("Aborted", "AbortError"));
  const result = await resultPromise;

  assert.equal(calls, 2);
  assert.equal(result.gameId, 2);
});

test("score fetcher advances after grace when fetch ignores abort", async () => {
  const clock = createClock();
  let calls = 0;

  const result = await fetchLatestPlayerMapScore(
    createOptions(
      clock,
      async () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<string>(() => {});
        }

        return createMatchPayload([createGame()]);
      },
      { totalBudgetMs: 250 },
    ),
  );

  assert.equal(calls, 2);
  assert.equal(result.gameId, 2);
});

test("score fetcher rethrows non-retryable transport errors", async () => {
  const clock = createClock();
  const apiError = new FetchTransportError("HTTP 401", false);

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        throw apiError;
      }),
    ),
    apiError,
  );
});

test("score fetcher surfaces retryable transport errors on budget exhaustion", async () => {
  const clock = createClock();

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => {
        throw new FetchTransportError("HTTP 500", true);
      }),
    ),
    (error) => {
      assert.ok(error instanceof ScoreApiTimeoutError);
      assert.equal(error.lastUnderlyingError?.message, "HTTP 500");
      return true;
    },
  );
});

test("score fetcher treats malformed numeric payloads as retryable", async () => {
  const clock = createClock();

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () =>
        createMatchPayload([createGame({ game_id: "123abc" })]),
      ),
    ),
    (error) => {
      assert.ok(error instanceof ScoreApiTimeoutError);
      assert.match(error.lastUnderlyingError?.message ?? "", /game_id/);
      return true;
    },
  );
});

test("score fetcher treats legacy API error envelopes as fatal", async () => {
  const clock = createClock();

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () =>
        JSON.stringify({ error: "Please provide a valid API key." }),
      ),
    ),
    (error) => {
      assert.ok(error instanceof FetchTransportError);
      assert.equal(error.retryable, false);
      assert.match(error.message, /valid API key/);
      return true;
    },
  );
});

test("score fetcher preserves arbitrary legacy API error messages", async () => {
  const clock = createClock();

  await assert.rejects(
    fetchLatestPlayerMapScore(
      createOptions(clock, async () => JSON.stringify({ error: "some unknown string" })),
    ),
    (error) => {
      assert.ok(error instanceof FetchTransportError);
      assert.equal(error.retryable, false);
      assert.equal(error.message, "some unknown string");
      return true;
    },
  );
});
