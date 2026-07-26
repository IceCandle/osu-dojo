import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  findLatestCompletedGame,
  MATCH_EVENT_LIMIT,
  normalizeModernPlayerScore,
  parseMatchEventWindow,
} from "@/lib/osu/matches";

function game(id: number, beatmapId: number, scores: unknown[] = []) {
  return {
    id,
    beatmap_id: beatmapId,
    end_time: "2026-07-24T00:00:00Z",
    mods: ["HR"],
    scores,
  };
}

test("match parser accepts the pinned public v2 match fixture", () => {
  const fixture = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "tests/fixtures/osu-v2-match-121570463.json",
      ),
      "utf8",
    ),
  ) as unknown;
  const parsed = parseMatchEventWindow(fixture);
  const parsedGame = parsed.events[0]?.game;
  assert.ok(parsedGame);
  assert.equal(parsedGame.beatmapId, 3981606);
  assert.deepEqual(parsedGame.mods, [{ acronym: "NF" }]);
  assert.equal(parsedGame.scores[0]?.legacyTotalScore, 385013);
  assert.deepEqual(parsedGame.scores[0]?.statistics, {
    great: 649,
    ok: 74,
    meh: 7,
    miss: 3,
  });
});

test("match parser defaults omitted zero-valued statistics to zero", () => {
  const parsed = parseMatchEventWindow(
    window([
      {
        id: 1,
        game: game(2, 259, [
          score(42, {
            statistics: { great: 100 },
          }),
        ]),
      },
    ]),
  );

  assert.deepEqual(parsed.events[0]?.game?.scores[0]?.statistics, {
    great: 100,
    ok: 0,
    meh: 0,
    miss: 0,
  });
});

function score(userId = 42, overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    legacy_total_score: 900000,
    max_combo: 700,
    passed: true,
    statistics: { great: 100, ok: 20, meh: 3, miss: 1 },
    mods: [{ acronym: "HR" }, { acronym: "HD" }],
    ...overrides,
  };
}

function window(
  events: Array<{ id: number; game: unknown | null }>,
  firstEventId = 1,
  latestEventId = events.at(-1)?.id ?? firstEventId,
) {
  return {
    first_event_id: firstEventId,
    latest_event_id: latestEventId,
    events,
  };
}

test("match lookup chooses the last completed unprocessed target game", async () => {
  const result = await findLatestCompletedGame({
    beatmapId: 259,
    processedGameIds: new Set([1]),
    fetchWindow: async () =>
      window([
        { id: 1, game: game(1, 259, [score()]) },
        { id: 2, game: game(2, 259, [score()]) },
      ]),
  });
  assert.equal(result.game?.id, 2);
});

test("match lookup preserves an in-progress target game", async () => {
  const result = await findLatestCompletedGame({
    beatmapId: 259,
    processedGameIds: new Set(),
    fetchWindow: async () =>
      window([
        {
          id: 1,
          game: { ...game(2, 259), end_time: undefined },
        },
      ]),
  });

  assert.equal(result.game?.id, 2);
  assert.equal(result.game?.endTime, null);
});

test("match parser isolates malformed unrelated events and scores", () => {
  const parsed = parseMatchEventWindow(
    window([
      { id: 1, game: { id: "bad" } },
      {
        id: 2,
        game: game(2, 259, [
          { user_id: 99 },
          score(),
        ]),
      },
      { id: 3, game: null },
      null as unknown as { id: number; game: unknown | null },
    ]),
  );

  assert.deepEqual(
    parsed.events.map((event) => ({
      id: event.id,
      gameId: event.game?.id ?? null,
      scoreUserIds: event.game?.scores.map((value) => value.userId) ?? [],
    })),
    [
      { id: 1, gameId: null, scoreUserIds: [] },
      { id: 2, gameId: 2, scoreUserIds: [42] },
      { id: 3, gameId: null, scoreUserIds: [] },
    ],
  );
});

test("match lookup walks backward until a target several windows in the past", async () => {
  const cursors: Array<number | undefined> = [];
  const result = await findLatestCompletedGame({
    beatmapId: 259,
    processedGameIds: new Set(),
    fetchWindow: async (cursor) => {
      cursors.push(cursor.before);
      if (cursor.before === undefined) {
        return window([{ id: 300, game: null }], 1, 300);
      }
      if (cursor.before === 300) {
        return window([{ id: 200, game: null }], 1, 300);
      }
      return window([{ id: 100, game: game(9, 259, [score()]) }], 1, 300);
    },
  });
  assert.equal(result.game?.id, 9);
  assert.deepEqual(cursors, [undefined, 300, 200]);
});

test("match lookup terminates on first event, empty page, and stalled cursor", async () => {
  for (const older of [
    window([], 1, 100),
    window([{ id: 100, game: null }], 1, 100),
    window([{ id: 1, game: null }], 1, 100),
  ]) {
    let calls = 0;
    const result = await findLatestCompletedGame({
      beatmapId: 259,
      processedGameIds: new Set(),
      fetchWindow: async (cursor) => {
        calls += 1;
        return cursor.before === undefined
          ? window([{ id: 100, game: null }], 1, 100)
          : older;
      },
    });
    assert.equal(result.game, null);
    assert.ok(calls <= 2);
  }
});

test("incremental match lookup continues forward while a window is full", async () => {
  const events = Array.from({ length: MATCH_EVENT_LIMIT }, (_, index) => ({
    id: index + 11,
    game: null,
  }));
  const afterValues: number[] = [];
  const result = await findLatestCompletedGame({
    beatmapId: 259,
    processedGameIds: new Set(),
    afterEventId: 10,
    fetchWindow: async (cursor) => {
      afterValues.push(cursor.after!);
      return cursor.after === 10
        ? window(events, 1, 500)
        : window([{ id: 112, game: game(12, 259, [score()]) }], 1, 500);
    },
  });
  assert.equal(result.game?.id, 12);
  assert.deepEqual(afterValues, [10, 111]);
  assert.equal(result.latestEventId, 500);
});

test("modern score adapter subtracts game mods from player mods", () => {
  const parsed = parseMatchEventWindow(
    window([{ id: 1, game: game(2, 259, [score()]) }]),
  );
  const parsedGame = parsed.events[0]?.game;
  assert.ok(parsedGame);
  const normalized = normalizeModernPlayerScore(
    parsedGame!,
    parsedGame!.scores[0]!,
  );
  assert.equal(normalized.globalGameMods, 16);
  assert.equal(normalized.playerEnabledMods, 8);
  assert.equal(normalized.score, 900000);
  assert.deepEqual(
    [
      normalized.count300,
      normalized.count100,
      normalized.count50,
      normalized.countMiss,
    ],
    [100, 20, 3, 1],
  );
});
