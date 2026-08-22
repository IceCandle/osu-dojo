import test from "node:test";
import assert from "node:assert/strict";
import { BanchoLobbyPlayerStates } from "bancho.js";
import { createTestDatabase } from "@/db/client";
import { createDojoBot } from "@/bot/runtime";
import {
  NoGameInApiError,
  NoPlayerScoreInGameError,
  ScoreApiTimeoutError,
} from "@/bot/osuApi";
import {
  createCapturingLogger,
  createSeededStartMessage,
  createTempDatabaseUrl,
  FakeClient,
  FakeUser,
  flushAsyncWork,
  latestMeaningfulLobbyMessage,
} from "./helpers/botRuntime";

test("bot aborts an active run when Bancho reports the match was aborted", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    client.lobby.emit("playerJoined", {
      player: client.lobby.registerPlayer(user),
    });
    await flushAsyncWork();

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchAborted");
    await flushAsyncWork(6);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /match was interrupted before completion/i,
    );
    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.ok(
      entries.some(
        (entry) =>
          entry.level === "warn" && entry.message === "dojo match aborted during play",
      ),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot aborts with score-not-yet-published when confirmed-finish score resolution never arrives", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const endedEvents: Array<{
      runId: string;
      playerUserId: number;
      result: string;
      reason?: string;
    }> = [];
    const fetchCalls: Array<{
      deadlineDurationMs: number;
      perCallTimeoutMs: number;
      retryDelayMs: number;
    }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async (options) => {
        fetchCalls.push({
          deadlineDurationMs: options.deadlineDurationMs,
          perCallTimeoutMs: options.perCallTimeoutMs,
          retryDelayMs: options.retryDelayMs,
        });
        throw new NoGameInApiError({
          beatmapId: 259,
          elapsedMs: 45_000,
          attempts: 16,
        });
      },
    });

    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
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
    await flushAsyncWork(6);

    assert.deepEqual(fetchCalls, [
      { deadlineDurationMs: 45_000, perCallTimeoutMs: 4_000, retryDelayMs: 2_500 },
    ]);
    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /you finished the map, but the osu! api did not publish the match result in time/i,
    );
    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.equal(endedEvents[0]?.result, "aborted");
    assert.equal(endedEvents[0]?.reason, "score-not-yet-published");
    const timeoutWarning = entries.find(
      (entry) =>
        entry.level === "warn" &&
        entry.message === "dojo score not yet published",
    );
    assert.ok(timeoutWarning);
    assert.equal(timeoutWarning.fields?.["elapsedMs"], 45_000);
    assert.equal(timeoutWarning.fields?.["attempts"], 16);
  } finally {
    temp.cleanup();
  }
});

test("bot aborts with score-not-found when the API game omits the player score", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const endedEvents: Array<{
      runId: string;
      playerUserId: number;
      result: string;
      reason?: string;
    }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async () => {
        throw new NoPlayerScoreInGameError({
          gameId: 17,
          userId: 42,
          elapsedMs: 4_000,
          attempts: 4,
        });
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
    await flushAsyncWork(6);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /no score was recorded/i,
    );
    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.equal(endedEvents[0]?.reason, "score-not-found");
    const scoreWarning = entries.find(
      (entry) => entry.level === "warn" && entry.message === "dojo score not found",
    );
    assert.ok(scoreWarning);
    assert.equal(scoreWarning.fields?.["hadConfirmedFinish"], false);
    assert.equal(scoreWarning.fields?.["gameId"], 17);
  } finally {
    temp.cleanup();
  }
});

test("bot keeps score-not-found when Bancho confirmed finish but API omits the player score", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async () => {
        throw new NoPlayerScoreInGameError({
          gameId: 17,
          userId: 42,
          elapsedMs: 45_000,
          attempts: 16,
        });
      },
    });

    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
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
    await flushAsyncWork(6);

    assert.match(latestMeaningfulLobbyMessage(client.lobby), /no score was recorded/i);
    assert.equal(endedEvents[0]?.reason, "score-not-found");
    const scoreWarning = entries.find(
      (entry) => entry.level === "warn" && entry.message === "dojo score not found",
    );
    assert.ok(scoreWarning);
    assert.equal(scoreWarning.fields?.["hadConfirmedFinish"], true);
  } finally {
    temp.cleanup();
  }
});

test("bot treats an unpublished API game without confirmed finish as an interrupted run", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async () => {
        throw new NoGameInApiError({
          beatmapId: 259,
          elapsedMs: 4_000,
          attempts: 4,
        });
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
    await flushAsyncWork(6);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /match was interrupted before completion/i,
    );
    assert.equal(endedEvents[0]?.reason, "match-interrupted");
    const interruptedWarning = entries.find(
      (entry) =>
        entry.level === "warn" &&
        entry.message === "dojo interrupted run detected while resolving score",
    );
    assert.ok(interruptedWarning);
    assert.equal(interruptedWarning.fields?.["hadConfirmedFinish"], false);
  } finally {
    temp.cleanup();
  }
});

test("bot preserves missing-map precedence after score fetch fails without confirmed finish", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async () => {
        throw new NoGameInApiError({
          beatmapId: 259,
          elapsedMs: 4_000,
          attempts: 4,
        });
      },
    });

    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));

    const player = client.lobby.registerPlayer(user);
    client.lobby.emit("playerJoined", { player });
    await flushAsyncWork();
    client.lobby.setPlayerState(42, BanchoLobbyPlayerStates.NoMap);

    client.lobby.emit("matchStarted");
    client.lobby.emit("matchFinished");
    await flushAsyncWork(6);

    assert.match(latestMeaningfulLobbyMessage(client.lobby), /do not have the map yet/i);
    assert.equal(endedEvents[0]?.reason, "missing-map");
    assert.ok(
      entries.some(
        (entry) => entry.level === "warn" && entry.message === "dojo player missing map",
      ),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot aborts with score-api-timeout when confirmed-finish API calls time out", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async () => {
        throw new ScoreApiTimeoutError({
          elapsedMs: 45_000,
          attempts: 16,
          lastUnderlyingError: new Error("deadline"),
        });
      },
    });

    bot.events.on("runEnded", (event) => {
      endedEvents.push(event);
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
    await flushAsyncWork(6);

    assert.match(latestMeaningfulLobbyMessage(client.lobby), /api did not respond/i);
    assert.equal(endedEvents[0]?.reason, "score-api-timeout");
    const timeoutError = entries.find(
      (entry) => entry.level === "error" && entry.message === "dojo score api timeout",
    );
    assert.ok(timeoutError);
    assert.equal(timeoutError.fields?.["hadConfirmedFinish"], true);
  } finally {
    temp.cleanup();
  }
});

test("bot treats API timeout without confirmed finish as an interrupted run", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const endedEvents: Array<{ result: string; reason?: string }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async () => {
        throw new ScoreApiTimeoutError({
          elapsedMs: 4_000,
          attempts: 2,
          lastUnderlyingError: new Error("deadline"),
        });
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
    await flushAsyncWork(6);

    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /match was interrupted before completion/i,
    );
    assert.equal(endedEvents[0]?.reason, "match-interrupted");
    const interruptedWarning = entries.find(
      (entry) =>
        entry.level === "warn" &&
        entry.message === "dojo interrupted run detected while resolving score",
    );
    assert.ok(interruptedWarning);
    assert.equal(interruptedWarning.fields?.["cause"], "api-timeout");
  } finally {
    temp.cleanup();
  }
});
