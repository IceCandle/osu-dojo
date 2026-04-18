import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BanchoLobbyPlayerStates, BanchoLobbyWinConditions } from "bancho.js";
import type { BotLogger } from "@/bot/logger";
import { createTestDatabase } from "@/db/client";
import { getCourseByNameKey, listCourseRunsByNameKey } from "@/db/queries";
import { createTempDatabaseUrl as createTempDatabaseUrlWithPrefix } from "./helpers/tempDatabase";
import {
  createDojoBot,
  type BotClientLike,
  type BotUserLike,
  type LobbyLike,
  type PrivateMessageLike,
} from "@/bot/runtime";
import { DOJO_USAGE_LINE } from "@/bot/command";

const createTempDatabaseUrl = () => createTempDatabaseUrlWithPrefix("osudojo-bot-");

const SEEDED_SYSTEM_NAME_KEY = "test";
const SEEDED_COURSE_NAME_KEY = "1st";
const SEEDED_COURSE_SLUG = "test-1dan";
const SEEDED_START_COMMAND = `!dojo start ${SEEDED_SYSTEM_NAME_KEY} ${SEEDED_COURSE_NAME_KEY}`;

type FakeLobbyPlayer = {
  user: BotUserLike;
  state: Symbol;
};

class FakeUser implements BotUserLike {
  id?: number;
  username?: string;
  ircUsername: string;
  messages: string[] = [];

  constructor(userId: number, username: string) {
    this.id = userId;
    this.username = username;
    this.ircUsername = username;
  }

  async fetchFromAPI() {
    return { id: this.id ?? 0, username: this.username };
  }

  async sendMessage(message: string) {
    this.messages.push(message);
    return null;
  }
}

class FakeLobby extends EventEmitter implements LobbyLike {
  id = 777;
  invites: string[] = [];
  lockHistory = 0;
  mapHistory: number[] = [];
  modHistory: string[][] = [];
  settingsHistory: Array<{ teamMode?: number; winCondition?: number; size?: number }> = [];
  startHistory: number[] = [];
  channelMessages: string[] = [];
  closeLobbyCalls = 0;
  updateSettingsCalls = 0;
  players = new Map<number, FakeLobbyPlayer>();
  setMapError?: Error;
  getPlayerByIdError?: Error;
  updateSettingsHandler?: () => Promise<null>;
  startMatchHandler?: (timeout?: number) => Promise<null>;
  closeLobbyHandler?: () => Promise<null>;
  channel = {
    sendMessage: async (message: string) => {
      this.channelMessages.push(message);
      return null;
    },
  };

  registerPlayer(user: BotUserLike, state = BanchoLobbyPlayerStates.NotReady) {
    if (typeof user.id !== "number") {
      throw new Error("FakeLobby.registerPlayer requires a numeric user id.");
    }

    const player = { user, state };
    this.players.set(user.id, player);
    return player;
  }

  setPlayerState(userId: number, state: symbol) {
    const player = this.players.get(userId);
    if (!player) {
      throw new Error(`Fake player #${userId} is not registered.`);
    }
    player.state = state;
  }

  async fetchFromAPI() {
    return { games: [] };
  }

  async getPlayerById(id: number) {
    if (this.getPlayerByIdError) {
      throw this.getPlayerByIdError;
    }

    const player = this.players.get(id);
    if (!player) {
      throw new Error(`Player #${id} not found.`);
    }

    return player;
  }

  async updateSettings() {
    this.updateSettingsCalls += 1;

    if (this.updateSettingsHandler) {
      return this.updateSettingsHandler();
    }

    return null;
  }

  async lockSlots() {
    this.lockHistory += 1;
    return null;
  }

  async setMap(mapId: number) {
    if (this.setMapError) {
      throw this.setMapError;
    }

    this.mapHistory.push(mapId);
    return null;
  }

  async setMods(mods: unknown) {
    const values = Array.isArray(mods)
      ? mods.map((mod) =>
          typeof mod === "object" && mod && "shortMod" in mod
            ? String((mod as { shortMod: string }).shortMod).toUpperCase()
            : String(mod),
        )
      : [String(mods)];

    this.modHistory.push(values);
    return null;
  }

  async setSettings(teamMode?: number, winCondition?: number, size?: number) {
    this.settingsHistory.push({ teamMode, winCondition, size });
    return null;
  }

  async startMatch(timeout?: number) {
    this.startHistory.push(timeout ?? 0);

    if (this.startMatchHandler) {
      return this.startMatchHandler(timeout);
    }

    return null;
  }

  async invitePlayer(player: string) {
    this.invites.push(player);
    return null;
  }

  async closeLobby() {
    this.closeLobbyCalls += 1;

    if (this.closeLobbyHandler) {
      return this.closeLobbyHandler();
    }

    return null;
  }
}

class FakeClient extends EventEmitter implements BotClientLike {
  lobby = new FakeLobby();
  createLobbyCalls: Array<{ name: string; privateLobby?: boolean }> = [];
  createLobbyHandler?: (
    name: string,
    privateLobby?: boolean,
  ) => Promise<{ lobby: FakeLobby }>;
  disconnectCalls = 0;
  connectCalls = 0;

  async createLobby(name: string, privateLobby?: boolean) {
    this.createLobbyCalls.push({ name, privateLobby });
    if (this.createLobbyHandler) {
      return this.createLobbyHandler(name, privateLobby);
    }

    return { lobby: this.lobby };
  }

  async connect() {
    this.connectCalls += 1;
    return null;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }
}

function createPrivateMessage(user: BotUserLike, message: string): PrivateMessageLike {
  return { user, message, self: false };
}

function createCapturingLogger() {
  const entries: Array<{
    level: "info" | "warn" | "error";
    message: string;
    fields?: Record<string, unknown>;
  }> = [];

  const logger: BotLogger = {
    info(message, fields) {
      entries.push({ level: "info", message, fields });
    },
    warn(message, fields) {
      entries.push({ level: "warn", message, fields });
    },
    error(message, fields) {
      entries.push({ level: "error", message, fields });
    },
  };

  return { entries, logger };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

async function flushAsyncWork(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForTimer(milliseconds: number, turns = 6) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  await flushAsyncWork(turns);
}

function latestMeaningfulLobbyMessage(lobby: FakeLobby) {
  return (
    [...lobby.channelMessages]
      .reverse()
      .find(
        (message) =>
          !/^Lobby closing in \d+s\.$/i.test(message) && !/^!mp /i.test(message),
      ) ?? ""
  );
}

async function getSeededBeatmapIds(db: Awaited<ReturnType<typeof createTestDatabase>>["db"]) {
  const course = await getCourseByNameKey(
    SEEDED_SYSTEM_NAME_KEY,
    SEEDED_COURSE_NAME_KEY,
    db,
  );

  if (!course) {
    throw new Error("Missing seeded test course.");
  }

  return course.beatmaps.map((beatmap) => beatmap.beatmapId);
}

function createSeededStartMessage(user: BotUserLike) {
  return createPrivateMessage(user, SEEDED_START_COMMAND);
}

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
      ["osu!dojo: test / 1st", "osu!dojo: test / 1st"],
    );
    assert.match(user.messages.at(-1) ?? "", /Room ready: osu!dojo: test \/ 1st/i);
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
  const originalSiteUrl = process.env.DOJO_SITE_URL;
  delete process.env.DOJO_SITE_URL;

  try {
    const { db } = await createTestDatabase(temp.url);
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
      delete process.env.DOJO_SITE_URL;
    } else {
      process.env.DOJO_SITE_URL = originalSiteUrl;
    }
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
      fetchScore: async (_lobby, options) => ({
        gameId: options.beatmapId,
        beatmapId: options.beatmapId,
        userId: 42,
        score: 999999,
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
    const calls: Array<{ beatmapId: number; attempts?: number; delayMs?: number }> = [];

    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async (_lobby, options) => {
        calls.push({
          beatmapId: options.beatmapId,
          attempts: options.attempts,
          delayMs: options.delayMs,
        });

        if (options.beatmapId === seededBeatmapIds[0]) {
          return {
            gameId: 1,
            beatmapId: options.beatmapId,
            userId: 42,
            score: 910000,
            accuracy: 96.3,
            maxCombo: 800,
            count300: 1000,
            count100: 40,
            count50: 4,
            countMiss: 2,
            passed: true,
          };
        }

        return {
          gameId: 2,
          beatmapId: options.beatmapId,
          userId: 42,
          score: 905000,
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
        attempts: 15,
        delayMs: 3000,
      },
      {
        beatmapId: seededBeatmapIds[1],
        attempts: 4,
        delayMs: 1000,
      },
    ]);
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /1st: PASS/i);
  } finally {
    temp.cleanup();
  }
});

test("bot rejects duplicate active runs for the same player", async () => {
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
      fetchScore: async () => ({
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 900000,
        accuracy: 96,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 2,
        passed: true,
      }),
    });

    await bot.handlePrivateMessage(createSeededStartMessage(user));
    await bot.handlePrivateMessage(createSeededStartMessage(user));

    assert.match(user.messages.at(-1) ?? "", /already have an active run/i);
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
        accuracy: 96.3,
        maxCombo: 800,
        count300: 1000,
        count100: 40,
        count50: 4,
        countMiss: 2,
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

test("bot halts the course immediately when a map fails", async () => {
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
      firstMapCountdownSeconds: 0,
      finalGracePeriodMs: 0,
      fetchScore: async () => ({
        gameId: 1,
        beatmapId: seededBeatmapIds[0] ?? 0,
        userId: 42,
        score: 120_000,
        accuracy: 8,
        maxCombo: 50,
        count300: 100,
        count100: 20,
        count50: 10,
        countMiss: 30,
        passed: false,
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
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /1st: FAIL/i);

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.status, "fail");
    assert.equal(results?.runs[0]?.maps.length, 1);
    assert.equal(results?.runs[0]?.maps[0]?.passed, false);
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

test("bot aborts with score-resolution-timeout when confirmed-finish score resolution never arrives", async () => {
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
    const fetchCalls: Array<{ attempts?: number; delayMs?: number }> = [];
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      fetchScore: async (_lobby, options) => {
        fetchCalls.push({
          attempts: options.attempts,
          delayMs: options.delayMs,
        });
        throw new Error("No completed multiplayer game found for beatmap 259.");
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

    assert.deepEqual(fetchCalls, [{ attempts: 15, delayMs: 3000 }]);
    assert.match(
      latestMeaningfulLobbyMessage(client.lobby),
      /you finished the map, but the osu! api did not publish the match result in time/i,
    );
    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.equal(endedEvents[0]?.result, "aborted");
    assert.equal(endedEvents[0]?.reason, "score-resolution-timeout");
    const timeoutWarning = entries.find(
      (entry) =>
        entry.level === "warn" &&
        entry.message === "dojo score resolution timed out after confirmed player finish",
    );
    assert.ok(timeoutWarning);
    assert.ok(timeoutWarning.fields?.error instanceof Error);
  } finally {
    temp.cleanup();
  }
});

test("bot treats a missing player score after match finish as an interrupted run", async () => {
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
      fetchScore: async () => {
        throw new Error("Match 17 does not include a score for user 42.");
      },
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
    assert.equal(bot.activeRunsByUserId.has(42), false);
    assert.ok(
      entries.some(
        (entry) =>
          entry.level === "warn" &&
          entry.message === "dojo interrupted run detected while resolving score" &&
          entry.fields?.error instanceof Error,
      ),
    );
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
