import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createTestDatabase } from "@/db/client";
import { recordOpenLobby } from "@/db/queries";
import { createDojoBot, type BotClientLike } from "@/bot/runtime";
import {
  createCapturingLogger,
  createSeededStartMessage,
  createTempDatabaseUrl,
  FakeCleanupChannel,
  FakeClient,
  FakeLobby,
  FakeUser,
  flushAsyncWork,
  getOpenLobbyRows,
  getSeededBeatmapIds,
  waitForTimer,
} from "./helpers/botRuntime";

test("bot records an open lobby row when room creation succeeds", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const bot = createDojoBot({ client, db, connectOnStart: false });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    const rows = await getOpenLobbyRows(db);
    assert.deepEqual(rows, [
      {
        matchId: client.lobby.id,
        userId: 42,
        courseId: "course-test-1dan",
        openedAt: rows[0]?.openedAt,
      },
    ]);
  } finally {
    temp.cleanup();
  }
});

test("bot removes the open lobby row after normal completion closes the lobby", async () => {
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
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async (options) => ({
        gameId: options.beatmapId,
        beatmapId: options.beatmapId,
        userId: 42,
        score: options.beatmapId === seededBeatmapIds[0] ? 910000 : 905000,
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
    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.equal(client.lobby.closeLobbyCalls, 1);
    assert.deepEqual(await getOpenLobbyRows(db), []);
  } finally {
    temp.cleanup();
  }
});

test("bot replaces the persisted lobby row when a run is superseded", async () => {
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
    const bot = createDojoBot({ client, db, connectOnStart: false, finalGracePeriodMs: 0 });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await flushAsyncWork(6);

    assert.equal(firstLobby.closeLobbyCalls, 1);
    assert.deepEqual(
      (await getOpenLobbyRows(db)).map((row) => row.matchId),
      [secondLobby.id],
    );
  } finally {
    temp.cleanup();
  }
});

test("bot keeps the open lobby row when the client is disconnected before close", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const bot = createDojoBot({ client, db, connectOnStart: false, finalGracePeriodMs: 0 });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    client.emit("disconnected", new Error("lost irc"));
    await flushAsyncWork(8);
    await waitForTimer(20);

    assert.deepEqual(
      (await getOpenLobbyRows(db)).map((row) => row.matchId),
      [client.lobby.id],
    );
  } finally {
    temp.cleanup();
  }
});

test("bot removes the open lobby row after setup failure closes the lobby", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    client.lobby.updateSettingsHandler = async () => {
      throw new Error("settings failed");
    };
    const bot = createDojoBot({ client, db, connectOnStart: false });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.equal(client.lobby.closeLobbyCalls, 1);
    assert.deepEqual(await getOpenLobbyRows(db), []);
  } finally {
    temp.cleanup();
  }
});

test("bot stop removes open lobby rows for active lobbies", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const bot = createDojoBot({ client, db, connectOnStart: false });
    const user = new FakeUser(42, "PlayerOne");

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await bot.stop();

    assert.equal(client.lobby.closeLobbyCalls, 1);
    assert.deepEqual(await getOpenLobbyRows(db), []);
  } finally {
    temp.cleanup();
  }
});

test("bot startup cleanup closes and removes stale open lobby rows", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await recordOpenLobby({ matchId: 1001, userId: 42, courseId: "test-1dan" }, db);
    await recordOpenLobby({ matchId: 1002, userId: 43, courseId: "test-1dan" }, db);
    const client = new FakeClient();
    const channels = new Map([
      ["#mp_1001", new FakeCleanupChannel()],
      ["#mp_1002", new FakeCleanupChannel()],
    ]);
    client.getChannelHandler = (name) => channels.get(name);
    const bot = createDojoBot({ client, db, connectOnStart: false });

    await bot.start();
    await flushAsyncWork();

    assert.deepEqual(channels.get("#mp_1001")?.actions, ["join", "closeLobby", "leave"]);
    assert.deepEqual(channels.get("#mp_1002")?.actions, ["join", "closeLobby", "leave"]);
    assert.deepEqual(await getOpenLobbyRows(db), []);
  } finally {
    temp.cleanup();
  }
});

test("bot startup cleanup keeps rows when joining a stale lobby fails", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await recordOpenLobby({ matchId: 1001, userId: 42, courseId: "test-1dan" }, db);
    const client = new FakeClient();
    const channel = new FakeCleanupChannel();
    channel.joinError = new Error("join failed");
    client.getChannelHandler = () => channel;
    const { entries, logger } = createCapturingLogger();
    const bot = createDojoBot({ client, db, logger, connectOnStart: false });

    await bot.start();

    assert.deepEqual(channel.actions, ["join"]);
    assert.deepEqual(
      (await getOpenLobbyRows(db)).map((row) => row.matchId),
      [1001],
    );
    assert.ok(entries.some((entry) => entry.message === "dojo open lobby join failed"));
  } finally {
    temp.cleanup();
  }
});

test("bot startup cleanup removes rows when stale lobby close rejects", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await recordOpenLobby({ matchId: 1001, userId: 42, courseId: "test-1dan" }, db);
    const client = new FakeClient();
    const channel = new FakeCleanupChannel();
    channel.closeError = new Error("close failed");
    client.getChannelHandler = () => channel;
    const { entries, logger } = createCapturingLogger();
    const bot = createDojoBot({ client, db, logger, connectOnStart: false });

    await bot.start();
    await flushAsyncWork();

    assert.deepEqual(channel.actions, ["join", "closeLobby", "leave"]);
    assert.deepEqual(await getOpenLobbyRows(db), []);
    assert.ok(entries.some((entry) => entry.message === "dojo open lobby close failed"));
  } finally {
    temp.cleanup();
  }
});

test("bot startup cleanup removes rows when stale lobby leave rejects", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await recordOpenLobby({ matchId: 1001, userId: 42, courseId: "test-1dan" }, db);
    const client = new FakeClient();
    const channel = new FakeCleanupChannel();
    channel.leaveError = new Error("leave failed");
    client.getChannelHandler = () => channel;
    const { entries, logger } = createCapturingLogger();
    const bot = createDojoBot({ client, db, logger, connectOnStart: false });

    await bot.start();
    await flushAsyncWork();

    assert.deepEqual(channel.actions, ["join", "closeLobby", "leave"]);
    assert.deepEqual(await getOpenLobbyRows(db), []);
    assert.ok(entries.some((entry) => entry.message === "dojo open lobby leave failed"));
  } finally {
    temp.cleanup();
  }
});

test("bot startup cleanup keeps rows when getChannel returns undefined", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await recordOpenLobby({ matchId: 1001, userId: 42, courseId: "test-1dan" }, db);
    const client = new FakeClient();
    client.getChannelHandler = () => undefined;
    const { entries, logger } = createCapturingLogger();
    const bot = createDojoBot({ client, db, logger, connectOnStart: false });

    await bot.start();

    assert.deepEqual(
      (await getOpenLobbyRows(db)).map((row) => row.matchId),
      [1001],
    );
    assert.ok(
      entries.some(
        (entry) => entry.message === "dojo open lobby getChannel returned undefined",
      ),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot startup cleanup keeps rows when the client has no getChannel", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await recordOpenLobby({ matchId: 1001, userId: 42, courseId: "test-1dan" }, db);
    const client = Object.assign(new EventEmitter(), {
      createLobby: async () => ({ lobby: new FakeLobby() }),
      connect: async () => null,
    }) satisfies BotClientLike;
    const { entries, logger } = createCapturingLogger();
    const bot = createDojoBot({ client, db, logger, connectOnStart: false });

    await bot.start();

    assert.deepEqual(
      (await getOpenLobbyRows(db)).map((row) => row.matchId),
      [1001],
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry.message === "dojo open lobby cleanup skipped (client has no getChannel)",
      ),
    );
  } finally {
    temp.cleanup();
  }
});

