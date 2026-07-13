import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { runs, users } from "@/db/schema";
import { searchDanCatalog, searchPlayers } from "@/db/queries";
import { createTempDatabaseUrl } from "./helpers/dbFixtures";

test("searchPlayers collapses users and displays the latest stored username", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await db.insert(users).values([
      user(1001, "CurrentAlias", 1_800_000_200_000),
      user(1002, "OldAliasFan", 1_800_000_050_000),
    ]);
    await db.insert(runs).values([
      run("run-old", 1001, "OldAlias", 1_800_000_000_000),
      run("run-new", 1001, "NewAlias", 1_800_000_100_000),
      run("run-other", 1002, "OldAliasFan", 1_800_000_050_000),
    ]);

    const results = await searchPlayers("oldalias", db);

    assert.deepEqual(
      results.map((result) => ({
        userId: result.userId,
        username: result.username,
        avatarUrl: result.avatarUrl,
        country: result.country,
        gameMode: result.gameMode,
      })),
      [
        {
          userId: 1001,
          username: "CurrentAlias",
          avatarUrl: "https://a.ppy.sh/1001",
          country: null,
          gameMode: "osu",
        },
        {
          userId: 1002,
          username: "OldAliasFan",
          avatarUrl: "https://a.ppy.sh/1002",
          country: null,
          gameMode: "osu",
        },
      ],
    );
  } finally {
    temp.cleanup();
  }
});

test("searchPlayers treats LIKE metacharacters literally and caps results", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await db.insert(users).values([
      user(2001, "literal%player", 1_800_000_000_000),
      ...Array.from({ length: 12 }, (_, index) =>
        user(2100 + index, `CapPlayer${String(index).padStart(2, "0")}`, 1_800_000_010_000 + index),
      ),
    ]);
    await db.insert(runs).values([
      run("run-percent", 2001, "literal%player", 1_800_000_000_000),
      ...Array.from({ length: 12 }, (_, index) =>
        run(
          `run-cap-${index}`,
          2100 + index,
          `CapPlayer${String(index).padStart(2, "0")}`,
          1_800_000_010_000 + index,
        ),
      ),
    ]);

    assert.deepEqual(
      (await searchPlayers("%", db)).map((result) => result.username),
      ["literal%player"],
    );
    assert.equal((await searchPlayers("capplayer", db)).length, 10);
  } finally {
    temp.cleanup();
  }
});

test("searchDanCatalog includes player hits with catalog hits", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await db.insert(users).values(user(3001, "FirstDanEnjoyer", 1_800_000_000_000));
    await db.insert(runs).values(run("run-player", 3001, "FirstDanEnjoyer", 1_800_000_000_000));

    const courseResults = await searchDanCatalog("1st", db);
    const playerResults = await searchDanCatalog("firstdan", db);

    assert.equal(courseResults.courses[0]?.name, "1st");
    assert.deepEqual(courseResults.players, []);
    assert.equal(playerResults.players[0]?.username, "FirstDanEnjoyer");
  } finally {
    temp.cleanup();
  }
});

test("player search includes users-only identities and never resolves usernames from the network", async () => {
  const temp = createTempDatabaseUrl();
  const originalFetch = globalThis.fetch;

  try {
    const { db } = await createTestDatabase(temp.url);
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error("player search must not call fetch");
    }) as typeof fetch;

    await db.insert(users).values([
      user(4001, "StoredLocalPlayer", 1_800_000_000_000),
      user(4002, "LoginOnlyPlayer", 1_800_000_100_000),
    ]);
    await db
      .insert(runs)
      .values(run("run-local-player", 4001, "StoredLocalPlayer", 1_800_000_000_000));

    assert.deepEqual(await searchPlayers("MissingExactName", db), []);
    assert.equal((await searchPlayers("storedlocalplayer", db))[0]?.username, "StoredLocalPlayer");
    assert.equal((await searchPlayers("loginonly", db))[0]?.username, "LoginOnlyPlayer");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    temp.cleanup();
  }
});

function run(id: string, userId: number, username: string, completedAt: number) {
  return {
    id,
    userId,
    username,
    courseId: "course-test-1dan",
    passed: true,
    startedAt: completedAt - 60_000,
    completedAt,
    matchId: null,
  };
}

function user(osuUserId: number, username: string, updatedAt: number) {
  return {
    osuUserId,
    username,
    createdAt: updatedAt,
    updatedAt,
  };
}
