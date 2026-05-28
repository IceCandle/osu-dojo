import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { listCourseRunsByNameKey } from "@/db/queries";
import { createDojoBot } from "@/bot/runtime";
import {
  createCapturingLogger,
  createSeededStartMessage,
  createTempDatabaseUrl,
  FakeClient,
  FakeUser,
  flushAsyncWork,
  getSeededBeatmapIds,
  latestMeaningfulLobbyMessage,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
  setSeededBeatmapTotalObjects,
  setSeededCourseOverallPassConditions,
  waitForTimer,
} from "./helpers/botRuntime";

test("partial play skips the immediate Course targets: line but its results still count toward later progress", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededCourseOverallPassConditions(db, [
      { type: "courseAccuracy", threshold: 130 },
      { type: "totalScore", threshold: 30_000 },
      { type: "totalMissCount", threshold: 999 },
    ]);
    setSeededBeatmapTotalObjects(db, 1, 710);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    let fetchCalls = 0;
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 364,
        count100: 30,
        count50: 5,
        countMiss: 1,
        passed: true,
      },
      {
        gameId: 2,
        beatmapId: seededBeatmapIds[1] ?? 0,
        userId: 42,
        score: 905000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 95.2,
        maxCombo: 780,
        count300: 980,
        count100: 50,
        count50: 5,
        countMiss: 2,
        passed: true,
      },
    ];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      restDurationMs: 0,
      firstMapCountdownSeconds: 0,
      finalGracePeriodMs: 0,
      sleep: async () => {},
      fetchScore: async () => {
        fetchCalls += 1;
        const next = fetchedScores.shift();
        if (!next) {
          throw new Error("No fake score left.");
        }
        return next;
      },
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    assert.equal(client.lobby.startHistory.length, 2);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(client.lobby.mapHistory, [seededBeatmapIds[0], seededBeatmapIds[1]]);
    assert.ok(
      client.lobby.channelMessages.some((message) => /partial play/i.test(message)),
    );
    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message.startsWith("Course cannot pass:") &&
          message.includes("map 1 threshold failed") &&
          message.endsWith("Continuing remaining maps."),
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.equal(
      client.lobby.channelMessages.some((message) =>
        message.startsWith("Course targets:"),
      ),
      false,
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      entries.some(
        (entry) => entry.level === "warn" && entry.message === "dojo partial play detected",
      ),
    );

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(
      client.lobby.channelMessages.filter((message) =>
        message.startsWith("Course targets:"),
      ).length,
      1,
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Course targets: .*totalMissCount 3 \/ 999/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
    );

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(fetchCalls, 2);
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps.length, 2);
    assert.equal(results?.runs[0]?.maps[0]?.passed, false);
  } finally {
    temp.cleanup();
  }
});

test("bot final partial play skips Course targets and Course cannot pass", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededBeatmapTotalObjects(db, 2, 710);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 1000,
        count100: 40,
        count50: 5,
        countMiss: 1,
        passed: true,
      },
      {
        gameId: 2,
        beatmapId: seededBeatmapIds[1] ?? 0,
        userId: 42,
        score: 905000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 95.2,
        maxCombo: 780,
        count300: 364,
        count100: 30,
        count50: 5,
        countMiss: 1,
        passed: true,
      },
    ];
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      firstMapCountdownSeconds: 0,
      finalGracePeriodMs: 0,
      sleep: async () => {},
      fetchScore: async () => {
        const next = fetchedScores.shift();
        if (!next) {
          throw new Error("No fake score left.");
        }
        return next;
      },
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(
      client.lobby.channelMessages.filter((message) =>
        message.startsWith("Course targets:"),
      ).length,
      1,
      client.lobby.channelMessages.join("\n"),
    );
    assert.equal(
      client.lobby.channelMessages.some((message) =>
        message.startsWith("Course cannot pass:"),
      ),
      false,
      client.lobby.channelMessages.join("\n"),
    );
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /1st: FAIL/i);

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.maps[1]?.passed, false);
  } finally {
    temp.cleanup();
  }
});

test("bot refetches once for a small partial object-count gap and accepts a complete refetch", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededBeatmapTotalObjects(db, 1, 400);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 1,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 364,
        count100: 30,
        count50: 5,
        countMiss: 0,
        passed: true,
      },
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 1,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 365,
        count100: 30,
        count50: 5,
        countMiss: 0,
        passed: true,
      },
    ];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      restDurationMs: 20_000,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async () => {
        const next = fetchedScores.shift();
        if (!next) {
          throw new Error("No fake score left.");
        }
        return next;
      },
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    assert.equal(fetchedScores.length, 0);
    assert.equal(client.lobby.startHistory.length, 1);
    assert.equal(client.lobby.mapHistory.at(-1), seededBeatmapIds[1]);
    assert.doesNotMatch(latestMeaningfulLobbyMessage(client.lobby), /partial play/i);
    assert.ok(
      entries.some(
        (entry) =>
          entry.level === "warn" &&
          entry.message === "dojo partial play refetch scheduled",
      ),
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry.level === "info" &&
          entry.message === "dojo partial play refetch completed",
      ),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot still fails when a small partial object-count gap remains after refetch", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededBeatmapTotalObjects(db, 1, 400);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    let fetchCalls = 0;
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 1,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 364,
        count100: 30,
        count50: 5,
        countMiss: 0,
        passed: true,
      },
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 1,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 364,
        count100: 30,
        count50: 5,
        countMiss: 0,
        passed: true,
      },
      {
        gameId: 2,
        beatmapId: seededBeatmapIds[1] ?? 0,
        userId: 42,
        score: 905000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 95.2,
        maxCombo: 780,
        count300: 980,
        count100: 50,
        count50: 5,
        countMiss: 2,
        passed: true,
      },
    ];
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async () => {
        fetchCalls += 1;
        const next = fetchedScores.shift();
        if (!next) {
          throw new Error("No fake score left.");
        }
        return next;
      },
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    assert.equal(fetchCalls, 2);
    assert.equal(client.lobby.startHistory.length, 2);
    assert.ok(
      client.lobby.channelMessages.some((message) => /partial play - 399\/400/i.test(message)),
    );
    assert.equal(
      (await listCourseRunsByNameKey(
        SEEDED_SYSTEM_NAME_KEY,
        SEEDED_COURSE_NAME_KEY,
        db,
      ))?.runs.length,
      0,
    );

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(fetchCalls, 3);
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps[0]?.passed, false);
  } finally {
    temp.cleanup();
  }
});

test("bot preserves normal pass behavior when total object count is unknown", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 20_000,
      firstMapCountdownSeconds: 0,
      fetchScore: async () => ({
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 364,
        count100: 30,
        count50: 5,
        countMiss: 1,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    assert.equal(client.lobby.startHistory.length, 1);
    assert.equal(client.lobby.mapHistory.at(-1), seededBeatmapIds[1]);
    assert.ok(
      client.lobby.channelMessages.some((message) => /Map 2\/2:/i.test(message)),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot does not treat equal object counts as partial play", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededBeatmapTotalObjects(db, 1, 400);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 20_000,
      firstMapCountdownSeconds: 0,
      fetchScore: async () => ({
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 950_000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 98,
        maxCombo: 400,
        count300: 364,
        count100: 30,
        count50: 5,
        countMiss: 1,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    assert.equal(client.lobby.startHistory.length, 1);
    assert.equal(client.lobby.mapHistory.at(-1), seededBeatmapIds[1]);
    assert.doesNotMatch(latestMeaningfulLobbyMessage(client.lobby), /partial play/i);
  } finally {
    temp.cleanup();
  }
});

