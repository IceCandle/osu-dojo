import test from "node:test";
import assert from "node:assert/strict";
import { BanchoLobbyPlayerStates, BanchoLobbyWinConditions } from "bancho.js";
import { createTestDatabase } from "@/db/client";
import { listCourseRunsByNameKey } from "@/db/queries";
import { createDojoBot } from "@/bot/runtime";
import { DOJO_USAGE_LINE } from "@/bot/command";
import {
  createCapturingLogger,
  createDeferred,
  createPrivateMessage,
  createSeededStartMessage,
  createTempDatabaseUrl,
  emitLobbyMessage,
  FakeClient,
  FakeLobby,
  FakeUser,
  flushAsyncWork,
  getSeededBeatmapIds,
  latestMeaningfulLobbyMessage,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_COURSE_SLUG,
  SEEDED_SYSTEM_NAME_KEY,
  setSeededBeatmapFreemod,
  setSeededBeatmapPassConditions,
  setSeededCourseOverallPassConditions,
  waitForTimer,
} from "./helpers/botRuntime";

test("bot sends concise help without creating a lobby", async () => {
  const client = new FakeClient();
  const bot = createDojoBot({
    client,
    connectOnStart: false,
  });
  const user = new FakeUser(42, "PlayerOne");

  await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo help"));

  assert.deepEqual(user.messages, [DOJO_USAGE_LINE]);
  assert.equal(client.createLobbyCalls.length, 0);
});

test("bot replies to invalid dojo commands without creating a lobby", async () => {
  const client = new FakeClient();
  const bot = createDojoBot({
    client,
    connectOnStart: false,
  });
  const user = new FakeUser(42, "PlayerOne");

  await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo wat"));

  assert.equal(user.messages.at(-1), "Invalid command. Use !dojo help for a guide.");
  assert.equal(client.createLobbyCalls.length, 0);
});

test("bot ignores non-dojo private messages", async () => {
  const client = new FakeClient();
  const bot = createDojoBot({
    client,
    connectOnStart: false,
  });
  const user = new FakeUser(42, "PlayerOne");

  await bot.handlePrivateMessage(createPrivateMessage(user, "hello !dojo"));

  assert.deepEqual(user.messages, []);
  assert.equal(client.createLobbyCalls.length, 0);
});

test("bot reports no previous command when prev has no history", async () => {
  const client = new FakeClient();
  const bot = createDojoBot({
    client,
    connectOnStart: false,
  });
  const user = new FakeUser(42, "PlayerOne");

  await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo prev"));

  assert.equal(
    user.messages.at(-1),
    "No previous command. Use !dojo start <system-name> <course-name> to begin.",
  );
  assert.equal(client.createLobbyCalls.length, 0);
});

test("bot rejects unknown courses", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo start nope nope"));

    assert.match(user.messages.at(-1) ?? "", /Unknown course/i);
    assert.equal(client.createLobbyCalls.length, 0);

    await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo prev"));

    assert.equal(
      user.messages.at(-1),
      "No previous command. Use !dojo start <system-name> <course-name> to begin.",
    );
  } finally {
    temp.cleanup();
  }
});

test("bot keeps previous command history per player", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });
    const playerOne = new FakeUser(42, "PlayerOne");
    const playerTwo = new FakeUser(99, "PlayerTwo");

    await bot.handlePrivateMessage(createSeededStartMessage(playerOne));
    await bot.handlePrivateMessage(createPrivateMessage(playerTwo, "!dojo prev"));

    assert.equal(client.createLobbyCalls.length, 1);
    assert.equal(
      playerTwo.messages.at(-1),
      "No previous command. Use !dojo start <system-name> <course-name> to begin.",
    );
  } finally {
    temp.cleanup();
  }
});

test("bot replays the previous start command after the active run is released", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      finalGracePeriodMs: 0,
    });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    const player = client.lobby.registerPlayer(user);
    client.lobby.emit("playerJoined", { player });
    await flushAsyncWork();
    client.lobby.emit("playerLeft", player);
    await flushAsyncWork();

    assert.equal(bot.activeRunsByUserId.size, 0);

    await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo prev"));

    assert.equal(client.createLobbyCalls.length, 2);
    assert.deepEqual(
      client.createLobbyCalls.map((call) => call.name),
      [
        "(osu!dojo): (PlayerOne) vs (test 1st)",
        "(osu!dojo): (PlayerOne) vs (test 1st)",
      ],
    );
    assert.match(
      user.messages.at(-1) ?? "",
      /Room ready: \(osu!dojo\): \(PlayerOne\) vs \(test 1st\)/i,
    );
  } finally {
    temp.cleanup();
  }
});

test("bot remembers a valid start command when lobby creation fails", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    let createLobbyAttempts = 0;
    client.createLobbyHandler = async () => {
      createLobbyAttempts += 1;
      if (createLobbyAttempts === 1) {
        throw new Error("Bancho unavailable");
      }

      return { lobby: client.lobby };
    };

    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.match(user.messages.at(-1) ?? "", /Failed to create the multiplayer room/i);
    assert.equal(bot.activeRunsByUserId.size, 0);

    await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo prev"));

    assert.equal(client.createLobbyCalls.length, 2);
    assert.match(user.messages.at(-1) ?? "", /Join the invite to begin/i);
  } finally {
    temp.cleanup();
  }
});

test("bot runs the seeded course, forces NF, switches to ScoreV2, and stores the result", async () => {
  const temp = createTempDatabaseUrl();
  const originalSiteUrl = process.env["DOJO_SITE_URL"];
  delete process.env["DOJO_SITE_URL"];

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededCourseOverallPassConditions(db, [
      { type: "courseAccuracy", threshold: 130 },
      { type: "totalScore", threshold: 30_000 },
      { type: "totalMissCount", threshold: 999 },
    ]);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const endedEvents: Array<{
      runId: string;
      playerUserId: number;
      result: string;
      reason?: string;
    }> = [];
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
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
    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.equal(client.createLobbyCalls[0]?.privateLobby, undefined);
    assert.deepEqual(client.lobby.invites, ["#42"]);
    assert.equal(client.lobby.lockHistory, 1);
    assert.match(
      user.messages[0] ?? "",
      /http:\/\/localhost:3000\/dan\/test\?course=1st/i,
    );

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    assert.equal(client.lobby.mapHistory[0], seededBeatmapIds[0]);
    assert.ok(client.lobby.modHistory[0]?.includes("NF"));
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Map 1\/2: beatmap .* with DT\. Starting in 0s\./.test(message),
      ),
    );
    assert.equal(
      client.lobby.channelMessages.some((message) =>
        /Map 1\/2: beatmap .* with .*NF/.test(message),
      ),
      false,
    );
    assert.equal(client.lobby.startHistory[0], 0);

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(
      client.lobby.settingsHistory[1]?.winCondition,
      BanchoLobbyWinConditions.ScoreV2,
    );
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /1st: PASS/i);
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /adjusted total score:/i);
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /raw score: 910,000 \(target >= \d+\)/.test(message),
      ),
    );
    assert.equal(
      client.lobby.channelMessages.filter((message) =>
        message.startsWith("Course targets:"),
      ).length,
      2,
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message ===
          "Course targets: courseAccuracy 96.30% / 130.00%; adjusted total score 910,000 / 30,000; totalMissCount 1 / 999",
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.equal(
      client.lobby.channelMessages.some((message) =>
        message.startsWith("Course cannot pass:"),
      ),
      false,
    );
    assert.equal(client.lobby.closeLobbyCalls, 1);
    assert.equal(endedEvents[0]?.result, "completed");
    assert.equal(endedEvents[0]?.reason, undefined);

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs.length, 1);
    assert.equal(results?.runs[0]?.username, "PlayerOne");
    assert.equal(results?.runs[0]?.matchId, client.lobby.id);
    assert.equal(results?.runs[0]?.maps[0]?.gameId, 1);
    assert.equal(results?.runs[0]?.maps[1]?.gameId, 2);
  } finally {
    if (originalSiteUrl === undefined) {
      delete process.env["DOJO_SITE_URL"];
    } else {
      process.env["DOJO_SITE_URL"] = originalSiteUrl;
    }
    temp.cleanup();
  }
});

test("bot enables freemod per map, judges adjusted score, and stores raw audit data", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapFreemod(db, 1, true);
    setSeededBeatmapFreemod(db, 2, false);
    setSeededBeatmapPassConditions(db, 1, [{ type: "score", threshold: 999_999 }]);
    setSeededCourseOverallPassConditions(db, [
      { type: "totalScore", threshold: 1_900_000 },
    ]);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 1_166_000,
        playerEnabledMods: 24,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
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
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(client.lobby.freemodHistory[0], true);
    assert.equal(client.lobby.freemodHistory[1], false);
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /raw score: 1,166,000 \(target >= 1,165,999\)/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Targets: adjusted score >= 999,999/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /FreeMod allowed: NF optional, NM, HD, HR, HDHR/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /PlayerOne: played without NF - add NF on FreeMod maps so a fail still submits a score\./.test(
          message,
        ),
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Targets: .*raw score >= 900,000/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Course targets: adjusted total score 1,000,000 \/ 1,900,000/.test(
          message,
        ),
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /adjusted total score: 1,905,000 \(target >= 1,900,000\)/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.equal(
      client.lobby.channelMessages.filter((message) => /Course targets:/.test(message))
        .length,
      2,
    );

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const firstMap = results?.runs[0]?.maps[0];
    assert.equal(firstMap?.rawScore, 1_166_000);
    assert.equal(firstMap?.score, 1_000_000);
    assert.equal(firstMap?.playedMods, "HDHR");
    assert.equal(firstMap?.passed, true);
  } finally {
    temp.cleanup();
  }
});

test("bot omits fixed-mod final raw score zero target when totalScore is already satisfied", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapFreemod(db, 2, false);
    setSeededBeatmapPassConditions(db, 2, [{ type: "accuracy", threshold: 10 }]);
    setSeededCourseOverallPassConditions(db, [
      { type: "totalScore", threshold: 500_000 },
    ]);
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async () => ({
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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

    assert.ok(
      client.lobby.channelMessages.some((message) => message === "Targets: accuracy >= 10.00%"),
      client.lobby.channelMessages.join("\n"),
    );
    assert.equal(
      client.lobby.channelMessages.some((message) => /raw score >= 0/.test(message)),
      false,
      client.lobby.channelMessages.join("\n"),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot omits FreeMod raw score choices when final totalScore target is zero", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapFreemod(db, 2, true);
    setSeededBeatmapPassConditions(db, 2, [{ type: "accuracy", threshold: 10 }]);
    setSeededCourseOverallPassConditions(db, [
      { type: "totalScore", threshold: 500_000 },
    ]);
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async () => ({
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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

    assert.ok(
      client.lobby.channelMessages.some((message) => message === "Targets: accuracy >= 10.00%"),
      client.lobby.channelMessages.join("\n"),
    );
    assert.equal(
      client.lobby.channelMessages.some((message) =>
        message.startsWith("Raw score by choice:"),
      ),
      false,
      client.lobby.channelMessages.join("\n"),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot reports Course targets after a full map with an exhausted miss budget", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededCourseOverallPassConditions(db, [
      { type: "totalMissCount", threshold: 1 },
    ]);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
        countMiss: 0,
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
    await waitForTimer(20);

    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Course targets: totalMissCount 1 \/ 1/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot suppresses final course guidance after impossibility was announced", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededCourseOverallPassConditions(db, [
      { type: "totalMissCount", threshold: 0 },
    ]);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
        countMiss: 0,
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
    await waitForTimer(20);

    assert.equal(
      client.lobby.channelMessages.some((message) => message.startsWith("Course target:")),
      false,
      client.lobby.channelMessages.join("\n"),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot announces totalMissCount impossibility mid-course and only once", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapPassConditions(db, 1, []);
    setSeededBeatmapPassConditions(db, 2, []);
    setSeededCourseOverallPassConditions(db, [
      { type: "totalMissCount", threshold: 1 },
    ]);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 2,
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

    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message ===
          "Course cannot pass: totalMissCount threshold exceeded. Continuing remaining maps.",
      ),
      client.lobby.channelMessages.join("\n"),
    );

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(
      client.lobby.channelMessages.filter((message) =>
        message.startsWith("Course cannot pass:"),
      ).length,
      1,
    );

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps.length, 2);
  } finally {
    temp.cleanup();
  }
});

test("bot announces unreachable courseAccuracy mid-course", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapPassConditions(db, 1, []);
    setSeededBeatmapPassConditions(db, 2, []);
    setSeededCourseOverallPassConditions(db, [
      { type: "courseAccuracy", threshold: 190 },
    ]);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 80,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
        accuracy: 100,
        maxCombo: 780,
        count300: 980,
        count100: 50,
        count50: 5,
        countMiss: 0,
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

    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message ===
          "Course cannot pass: courseAccuracy threshold unreachable. Continuing remaining maps.",
      ),
      client.lobby.channelMessages.join("\n"),
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
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps.length, 2);
  } finally {
    temp.cleanup();
  }
});

test("bot rejects disallowed freemod selections and persists a failed audit row", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapFreemod(db, 1, true);
    setSeededBeatmapPassConditions(db, 1, [{ type: "score", threshold: 999_999 }]);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 500_000,
        playerEnabledMods: 2,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
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
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.ok(
      client.lobby.channelMessages.some((message) => /Disallowed mods: EZ/.test(message)),
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

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const firstMap = results?.runs[0]?.maps[0];
    assert.equal(results?.runs[0]?.passed, false);
    assert.equal(results?.runs[0]?.maps.length, 2);
    assert.equal(firstMap?.passed, false);
    assert.equal(firstMap?.rawScore, 500_000);
    assert.equal(firstMap?.score, 1_000_000);
    assert.equal(firstMap?.playedMods, "EZ");
  } finally {
    temp.cleanup();
  }
});

test("bot playtests draft courses without storing results", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    db.$client
      .prepare("UPDATE dan_systems SET status = 'draft' WHERE slug = ?")
      .run(SEEDED_SYSTEM_NAME_KEY);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    let gameId = 0;
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async (options) => ({
        gameId: (gameId += 1),
        beatmapId: options.beatmapId,
        userId: 42,
        score: 999999,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 100,
        maxCombo: 800,
        count300: 1000,
        count100: 0,
        count50: 0,
        countMiss: 0,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.equal(client.createLobbyCalls[0]?.privateLobby, undefined);
    assert.match(client.createLobbyCalls[0]?.name ?? "", /^\(osu!dojo\):/);
    assert.deepEqual(client.lobby.invites, ["#42"]);
    assert.match(user.messages[0] ?? "", /Results will not be saved/i);

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();
    assert.equal(client.lobby.mapHistory[0], seededBeatmapIds[0]);

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs.length, 0);
    const runCount = db.$client.prepare("SELECT COUNT(*) AS count FROM runs").get() as {
      count: number;
    };
    assert.equal(runCount.count, 0);
  } finally {
    temp.cleanup();
  }
});

test("bot switches lobby scoring to ScoreV1 when the course requests it", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    db.$client
      .prepare("UPDATE courses SET score_model = ? WHERE slug = ?")
      .run("scorev1", SEEDED_COURSE_SLUG);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async (options) => ({
        gameId: options.beatmapId,
        beatmapId: options.beatmapId,
        userId: 42,
        score: 999999,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 100,
        maxCombo: 800,
        count300: 1000,
        count100: 0,
        count50: 0,
        countMiss: 0,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    assert.equal(client.lobby.mapHistory[0], seededBeatmapIds[0]);
    assert.equal(
      client.lobby.settingsHistory[0]?.winCondition,
      BanchoLobbyWinConditions.Score,
    );
  } finally {
    temp.cleanup();
  }
});

test("bot uses the confirmed-finish score fetch policy and completes the run", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const calls: Array<{
      beatmapId: number;
      totalBudgetMs: number;
      perCallTimeoutMs: number;
      retryDelayMs: number;
    }> = [];

    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async (options) => {
        calls.push({
          beatmapId: options.beatmapId,
          totalBudgetMs: options.totalBudgetMs,
          perCallTimeoutMs: options.perCallTimeoutMs,
          retryDelayMs: options.retryDelayMs,
        });

        if (options.beatmapId === seededBeatmapIds[0]) {
          return {
            gameId: 1,
            beatmapId: options.beatmapId,
            userId: 42,
            score: 910000,
            playerEnabledMods: 0,
            globalGameMods: 0,
            accuracy: 96.3,
            maxCombo: 800,
            count300: 1000,
            count100: 40,
            count50: 4,
            countMiss: 1,
            passed: true,
          };
        }

        return {
          gameId: 2,
          beatmapId: options.beatmapId,
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
        };
      },
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    const player = client.lobby.registerPlayer(user);
    client.lobby.emit("playerJoined", { player });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("playerFinished", {
      score: 910000,
      pass: true,
      player,
    });
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    assert.deepEqual(calls, [
      {
        beatmapId: seededBeatmapIds[0],
        totalBudgetMs: 45_000,
        perCallTimeoutMs: 4_000,
        retryDelayMs: 2_500,
      },
      {
        beatmapId: seededBeatmapIds[1],
        totalBudgetMs: 4_000,
        perCallTimeoutMs: 3_000,
        retryDelayMs: 1_000,
      },
    ]);
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /1st: PASS/i);
  } finally {
    temp.cleanup();
  }
});

test("bot supersedes an active run when the same player starts a valid course", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const firstLobby = new FakeLobby(777);
    const secondLobby = new FakeLobby(888);
    const lobbies = [firstLobby, secondLobby];
    client.lobby = firstLobby;
    client.createLobbyHandler = async () => {
      const lobby = lobbies.shift();
      if (!lobby) {
        throw new Error("No fake lobby left.");
      }
      client.lobby = lobby;
      return { lobby };
    };
    const user = new FakeUser(42, "PlayerOne");
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });
    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await flushAsyncWork(6);

    assert.equal(client.createLobbyCalls.length, 2);
    assert.equal(firstLobby.closeLobbyCalls, 1);
    assert.equal(secondLobby.closeLobbyCalls, 0);
    assert.equal(
      firstLobby.channelMessages.some((message) =>
        /starting a new course/i.test(message),
      ),
      true,
    );
    assert.equal(endedEvents.length, 1);
    assert.equal(endedEvents[0]?.result, "aborted");
    assert.equal(endedEvents[0]?.reason, "superseded-by-new-start");
    assert.equal(bot.activeRunsByUserId.get(42)?.lobby?.id, secondLobby.id);
    assert.deepEqual(secondLobby.invites, ["#42"]);
  } finally {
    temp.cleanup();
  }
});

test("bot keeps the active run when a duplicate start names an unknown course", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo start nope nope"));

    assert.match(user.messages.at(-1) ?? "", /Unknown course/i);
    assert.equal(client.createLobbyCalls.length, 1);
    assert.equal(client.lobby.closeLobbyCalls, 0);
    assert.equal(bot.activeRunsByUserId.get(42)?.lobby?.id, client.lobby.id);
  } finally {
    temp.cleanup();
  }
});

test("bot supersede during lobby setup does not let the old setup win", async () => {
  const temp = createTempDatabaseUrl();
  const firstSetupStarted = createDeferred<null>();
  const releaseFirstSetup = createDeferred<null>();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const firstLobby = new FakeLobby(777);
    const secondLobby = new FakeLobby(888);
    const lobbies = [firstLobby, secondLobby];
    let firstUpdateCalls = 0;
    firstLobby.updateSettingsHandler = async () => {
      firstUpdateCalls += 1;
      if (firstUpdateCalls === 1) {
        firstSetupStarted.resolve(null);
        return releaseFirstSetup.promise;
      }
      return null;
    };
    client.lobby = firstLobby;
    client.createLobbyHandler = async () => {
      const lobby = lobbies.shift();
      if (!lobby) {
        throw new Error("No fake lobby left.");
      }
      client.lobby = lobby;
      return { lobby };
    };
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });

    const firstStart = bot.handlePrivateMessage(createSeededStartMessage(user));
    await firstSetupStarted.promise;

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    releaseFirstSetup.resolve(null);
    await firstStart;
    await flushAsyncWork(6);

    assert.ok(firstLobby.closeLobbyCalls >= 1);
    assert.deepEqual(firstLobby.invites, []);
    assert.deepEqual(secondLobby.invites, ["#42"]);
    assert.equal(bot.activeRunsByUserId.get(42)?.lobby?.id, secondLobby.id);
    assert.equal(
      user.messages.filter((message) => /Room ready/i.test(message)).length,
      1,
    );
  } finally {
    releaseFirstSetup.resolve(null);
    temp.cleanup();
  }
});

test("bot does not supersede a run that is already finalizing", async () => {
  const temp = createTempDatabaseUrl();
  const finalMessageStarted = createDeferred<null>();
  const releaseFinalMessage = createDeferred<null>();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    let gameId = 0;
    client.lobby.channelMessageHandler = async (message) => {
      if (/^1st: PASS/i.test(message)) {
        finalMessageStarted.resolve(null);
        return releaseFinalMessage.promise;
      }
      return null;
    };
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      firstMapCountdownSeconds: 0,
      fetchScore: async (options) => ({
        gameId: (gameId += 1),
        beatmapId: options.beatmapId,
        userId: 42,
        score: options.beatmapId === seededBeatmapIds[0] ? 910000 : 905000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: options.beatmapId === seededBeatmapIds[0] ? 96.3 : 95.2,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 1,
        passed: true,
      }),
    });
    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
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
    await finalMessageStarted.promise;

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.equal(
      user.messages.at(-1),
      "Run is already finishing. Please try again in a moment.",
    );
    assert.equal(client.createLobbyCalls.length, 1);
    assert.equal(
      endedEvents.some((event) => event.reason === "superseded-by-new-start"),
      false,
    );

    releaseFinalMessage.resolve(null);
    await flushAsyncWork(8);

    assert.equal(endedEvents[0]?.result, "completed");
    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.status, "pass");
  } finally {
    releaseFinalMessage.resolve(null);
    temp.cleanup();
  }
});

test("bot persists a superseded run after at least one resolved map", async () => {
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
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 1,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    const player = client.lobby.registerPlayer(user);
    client.lobby.emit("playerJoined", { player });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(6);

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await flushAsyncWork(6);

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs.length, 1);
    assert.equal(results?.runs[0]?.status, "dnf");
    assert.equal(results?.runs[0]?.maps.length, 1);
  } finally {
    temp.cleanup();
  }
});

test("bot treats skip as an invalid DM command", async () => {
  const client = new FakeClient();
  const user = new FakeUser(42, "PlayerOne");
  const bot = createDojoBot({
    client,
    connectOnStart: false,
  });

  await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo skip"));

  assert.equal(user.messages.at(-1), "Invalid command. Use !dojo help for a guide.");
  assert.equal(client.createLobbyCalls.length, 0);
  assert.equal(client.lobby.startHistory.length, 0);
});

test("bot treats abort as an invalid DM command", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo abort"));

    assert.equal(user.messages.at(-1), "Invalid command. Use !dojo help for a guide.");
    assert.equal(bot.activeRunsByUserId.has(42), true);
    assert.equal(client.lobby.closeLobbyCalls, 0);
  } finally {
    temp.cleanup();
  }
});

test("bot ready event starts the pending countdown exactly once", async () => {
  const temp = createTempDatabaseUrl();
  const refreshStarted = createDeferred<null>();
  const releaseRefresh = createDeferred<null>();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      firstMapCountdownSeconds: 1,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user, BanchoLobbyPlayerStates.NotReady),
    });
    await flushAsyncWork();

    client.lobby.updateSettingsHandler = async () => {
      refreshStarted.resolve(null);
      return releaseRefresh.promise;
    };

    client.lobby.emit("allPlayersReady");
    await refreshStarted.promise;
    client.lobby.emit("allPlayersReady");
    await waitForTimer(1_100);

    assert.equal(client.lobby.startHistory.length, 0);

    releaseRefresh.resolve(null);
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 1);
    assert.equal(client.lobby.channelMessages.includes("!mp timer 1"), true);
    client.lobby.emit("matchStarted");
    await flushAsyncWork();
    client.lobby.emit("allPlayersReady");
    await flushAsyncWork();
    assert.equal(client.lobby.startHistory.length, 1);
  } finally {
    releaseRefresh.resolve(null);
    temp.cleanup();
  }
});

test("bot ready event between maps advances to the next map immediately", async () => {
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
      firstMapCountdownSeconds: 0,
      restDurationMs: 20_000,
      fetchScore: async () => ({
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 1,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user, BanchoLobbyPlayerStates.NotReady),
    });
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 1);
    assert.equal(client.lobby.mapHistory.at(-1), seededBeatmapIds[1]);

    client.lobby.emit("allPlayersReady");
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 2);
  } finally {
    temp.cleanup();
  }
});

test("bot ready event aborts with missing-map when the target player has no map", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      firstMapCountdownSeconds: 10,
    });
    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user, BanchoLobbyPlayerStates.NoMap),
    });
    await flushAsyncWork();

    client.lobby.emit("allPlayersReady");
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 0);
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /do not have the map yet/i);
    assert.equal(endedEvents[0]?.result, "aborted");
    assert.equal(endedEvents[0]?.reason, "missing-map");
  } finally {
    temp.cleanup();
  }
});

test("bot ready event does not start again after match started", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const target = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      firstMapCountdownSeconds: 10,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(target));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(target, BanchoLobbyPlayerStates.NotReady),
    });
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    await flushAsyncWork();

    client.lobby.emit("allPlayersReady");
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 0);
    assert.equal(bot.activeRunsByUserId.has(42), true);
  } finally {
    temp.cleanup();
  }
});

test("lobby chat !dojo skip no longer starts the match", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      firstMapCountdownSeconds: 10,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user, BanchoLobbyPlayerStates.NotReady),
    });
    await flushAsyncWork();
    const messageCount = client.lobby.channelMessages.length;

    emitLobbyMessage(client.lobby, user, "!dojo skip");
    await flushAsyncWork(6);

    assert.equal(client.lobby.channelMessages.length, messageCount);
    assert.equal(client.lobby.startHistory.length, 0);
    assert.equal(bot.activeRunsByUserId.has(42), true);
  } finally {
    temp.cleanup();
  }
});

test("bot aborts immediately when the target player leaves between maps", async () => {
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
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 1,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    const player = client.lobby.registerPlayer(user);
    client.lobby.emit("playerJoined", { player });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 1);
    assert.ok(client.lobby.channelMessages.includes("!mp timer 20"));
    client.lobby.emit("playerLeft", player);
    await flushAsyncWork(6);

    assert.match(latestMeaningfulLobbyMessage(client.lobby), /player left the room/i);
    assert.equal(bot.activeRunsByUserId.has(42), false);

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.status, "dnf");
    assert.equal(results?.runs[0]?.maps.length, 1);
  } finally {
    temp.cleanup();
  }
});

test("bot does not announce course impossibility after a final-map failure", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapPassConditions(db, 1, []);
    setSeededBeatmapPassConditions(db, 2, [{ type: "accuracy", threshold: 99 }]);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
      connectOnStart: false,
      restDurationMs: 0,
      firstMapCountdownSeconds: 0,
      finalGracePeriodMs: 0,
      fetchScore: async () => {
        const next = fetchedScores.shift();
        if (!next) {
          throw new Error("No fake score left.");
        }
        return next;
      },
    });
    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(
      client.lobby.channelMessages.some((message) =>
        message.startsWith("Course cannot pass:"),
      ),
      false,
      client.lobby.channelMessages.join("\n"),
    );
    assert.equal(endedEvents[0]?.result, "completed");

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps.length, 2);
    assert.equal(results?.runs[0]?.maps[1]?.passed, false);
  } finally {
    temp.cleanup();
  }
});

test("bot aborts after a failed map when the target player leaves between maps", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapPassConditions(db, 1, [{ type: "accuracy", threshold: 99 }]);
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
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 95,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 1,
        passed: true,
      }),
    });
    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    const player = client.lobby.registerPlayer(user);
    client.lobby.emit("playerJoined", { player });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);

    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message.startsWith("Course cannot pass:") &&
          message.includes("map 1 threshold failed") &&
          message.endsWith("Continuing remaining maps."),
      ),
      client.lobby.channelMessages.join("\n"),
    );

    client.lobby.emit("playerLeft", player);
    await flushAsyncWork(8);

    assert.equal(endedEvents[0]?.result, "aborted");
    assert.equal(endedEvents[0]?.reason, "player-left");

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps.length, 1);
  } finally {
    temp.cleanup();
  }
});

test("bot logs when the course impossibility announcement send fails", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    setSeededBeatmapPassConditions(db, 1, [{ type: "accuracy", threshold: 99 }]);
    client.lobby.channelMessageHandler = async (message) => {
      if (message.startsWith("Course cannot pass:")) {
        throw new Error("IRC send failed");
      }

      return null;
    };
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 95,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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

    assert.ok(
      entries.some(
        (entry) => entry.level === "error" && entry.message === "dojo lobby message failed",
      ),
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry.level === "warn" &&
          entry.message === "dojo course impossibility announcement send failed",
      ),
    );
    assert.equal(
      entries.filter(
        (entry) =>
          entry.level === "info" &&
          entry.message === "dojo course impossibility announced",
      ).length,
      1,
    );
  } finally {
    temp.cleanup();
  }
});

test("bot continues the course and announces once when a map fails", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededCourseOverallPassConditions(db, [
      { type: "courseAccuracy", threshold: 130 },
      { type: "totalScore", threshold: 30_000 },
      { type: "totalMissCount", threshold: 999 },
    ]);
    db.$client
      .prepare(
        `
        UPDATE beatmaps
        SET pass_conditions = ?
        WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
          AND ordinal = ?
        `,
      )
      .run(
        JSON.stringify([
          { type: "accuracy", threshold: 99 },
          { type: "missCount", threshold: 0 },
        ]),
        SEEDED_COURSE_SLUG,
        1,
      );

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const endedEvents: Array<{
      runId: string;
      playerUserId: number;
      result: string;
      reason?: string;
    }> = [];
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 0,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 100,
        maxCombo: 50,
        count300: 0,
        count100: 0,
        count50: 0,
        countMiss: 30,
        passed: false,
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
    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
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
    assert.equal(client.lobby.mapHistory.at(-1), seededBeatmapIds[1]);
    assert.equal(bot.activeRunsByUserId.has(42), true);
    assert.equal(endedEvents.length, 0);
    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message.startsWith("Course cannot pass:") &&
          message.includes("map 1 threshold failed") &&
          message.endsWith("Continuing remaining maps."),
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /accuracy: 100\.00% \(target >= 99\.00%\)/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /miss: 30 \(target <= 0\)/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message ===
          "Course targets: courseAccuracy 0.00% / 130.00%; adjusted total score 0 / 30,000; totalMissCount 30 / 999",
      ),
      client.lobby.channelMessages.join("\n"),
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

    assert.equal(
      client.lobby.channelMessages.filter((message) =>
        message.startsWith("Course targets:"),
      ).length,
      2,
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some(
        (message) =>
          message ===
          "Course targets: courseAccuracy 95.20% / 130.00%; adjusted total score 905,000 / 30,000; totalMissCount 32 / 999",
      ),
      client.lobby.channelMessages.join("\n"),
    );

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /1st: FAIL/i);
    assert.equal(endedEvents[0]?.result, "completed");
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps.length, 2);
    assert.equal(results?.runs[0]?.maps[0]?.passed, false);
    assert.equal(results?.runs[0]?.maps[1]?.passed, true);
  } finally {
    temp.cleanup();
  }
});

test("bot aborts inactive runs before the player joins and allows a fresh restart", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      inactivityTimeoutMs: 40,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await waitForTimer(60);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /inactive for too long/i,
    );
    assert.equal(bot.activeRunsByUserId.has(42), false);

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.equal(client.createLobbyCalls.length, 2);
    assert.match(user.messages.at(-1) ?? "", /Join the invite to begin/i);
  } finally {
    temp.cleanup();
  }
});

test("bot resets the inactivity timer when the run makes progress", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      inactivityTimeoutMs: 1_000,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    await waitForTimer(300);
    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    await waitForTimer(300);
    assert.equal(bot.activeRunsByUserId.has(42), true);

    await waitForTimer(800);
    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /inactive for too long/i,
    );
  } finally {
    temp.cleanup();
  }
});

test("bot aborts active runs when the IRC client disconnects and emits runEnded", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const endedEvents: Array<{
      runId: string;
      playerUserId: number;
      result: string;
      reason?: string;
    }> = [];
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });

    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
    });

    await bot.start();
    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.emit("disconnected", new Error("socket closed"));
    await flushAsyncWork(8);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /bot disconnected from Bancho/i,
    );
    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.equal(endedEvents[0]?.result, "aborted");
    assert.equal(endedEvents[0]?.reason, "irc-disconnected");
  } finally {
    temp.cleanup();
  }
});

test("bot logs when the released lobby closes", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
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
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);
    await flushAsyncWork(12);

    assert.equal(client.lobby.closeLobbyCalls, 1);
    assert.equal(
      entries.filter((entry) => entry.level === "info" && entry.message === "dojo lobby closed")
        .length,
      1,
    );
  } finally {
    temp.cleanup();
  }
});

test("bot does not log lobby closed when closeLobby fails", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    client.lobby.closeLobbyHandler = async () => {
      throw new Error("Bancho close failed");
    };
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 0,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 0,
        maxCombo: 50,
        count300: 0,
        count100: 0,
        count50: 0,
        countMiss: 30,
        passed: false,
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
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
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
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);
    await flushAsyncWork(12);

    assert.equal(client.lobby.closeLobbyCalls, 1);
    assert.ok(
      entries.some(
        (entry) => entry.level === "warn" && entry.message === "dojo lobby close failed",
      ),
    );
    assert.equal(
      entries.filter((entry) => entry.level === "info" && entry.message === "dojo lobby closed")
        .length,
      0,
    );
  } finally {
    temp.cleanup();
  }
});

test("bot cleanup does not block forever when closeLobby hangs", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    const fetchedScores = [
      {
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 910000,
        playerEnabledMods: 0,
        globalGameMods: 0,
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
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
    client.lobby.closeLobbyHandler = async () => new Promise<null>(() => {});
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
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
    await flushAsyncWork();
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.equal(client.lobby.closeLobbyCalls, 1);
    assert.ok(
      entries.some(
        (entry) => entry.level === "warn" && entry.message === "dojo lobby close timed out",
      ),
    );
    assert.equal(
      entries.filter((entry) => entry.level === "info" && entry.message === "dojo lobby closed")
        .length,
      0,
    );
  } finally {
    temp.cleanup();
  }
});

test("bot.stop waits for active-run cleanup and closes the lobby", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.equal(bot.activeRunsByUserId.has(42), true);

    await bot.stop();

    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.equal(client.lobby.closeLobbyCalls, 1);
  } finally {
    temp.cleanup();
  }
});

test("bot aborts before the first map starts when delayed refresh shows NoMap", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      firstMapCountdownSeconds: 0,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user, BanchoLobbyPlayerStates.NoMap),
    });
    await flushAsyncWork(6);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /do not have the map yet/i,
    );
    assert.equal(client.lobby.startHistory.length, 0);
    assert.equal(bot.activeRunsByUserId.has(42), false);
  } finally {
    temp.cleanup();
  }
});

test("bot aborts with a generic message when the first pure start never produces matchStarted", async () => {
  const temp = createTempDatabaseUrl();
  const hangingStart = createDeferred<null>();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    client.lobby.startMatchHandler = async () => hangingStart.promise;
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      firstMapCountdownSeconds: 0,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user, BanchoLobbyPlayerStates.NotReady),
    });
    await flushAsyncWork(6);
    await waitForTimer(2_100);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /match failed to start/i,
    );
    assert.equal(bot.activeRunsByUserId.has(42), false);
  } finally {
    hangingStart.reject(new Error("test cleanup"));
    await flushAsyncWork(4);
    temp.cleanup();
  }
});

test("bot ignores late lobby events after inactivity cleanup", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      inactivityTimeoutMs: 40,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await waitForTimer(60);

    const abortMessageCount = client.lobby.channelMessages.filter((message) =>
      /inactive for too long/i.test(message),
    ).length;

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    client.lobby.emit("startTimerAborted");
    await flushAsyncWork(8);

    const finalAbortMessageCount = client.lobby.channelMessages.filter((message) =>
      /inactive for too long/i.test(message),
    ).length;

    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.equal(finalAbortMessageCount, abortMessageCount);
  } finally {
    temp.cleanup();
  }
});
