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
import {
  NoGameInApiError,
  NoPlayerScoreInGameError,
  ScoreApiTimeoutError,
} from "@/bot/osuApi";
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

class FakeLobbyChannel extends EventEmitter {
  messages: string[] = [];
  handler?: (message: string) => Promise<null>;

  async sendMessage(message: string) {
    this.messages.push(message);
    if (this.handler) {
      return this.handler(message);
    }

    return null;
  }
}

class FakeLobby extends EventEmitter implements LobbyLike {
  id: number;
  invites: string[] = [];
  lockHistory = 0;
  mapHistory: number[] = [];
  modHistory: string[][] = [];
  freemodHistory: Array<boolean | undefined> = [];
  settingsHistory: Array<{ teamMode?: number; winCondition?: number; size?: number }> = [];
  startHistory: number[] = [];
  closeLobbyCalls = 0;
  updateSettingsCalls = 0;
  players = new Map<number, FakeLobbyPlayer>();
  setMapError?: Error;
  getPlayerByIdError?: Error;
  updateSettingsHandler?: () => Promise<null>;
  startMatchHandler?: (timeout?: number) => Promise<null>;
  closeLobbyHandler?: () => Promise<null>;
  channel = new FakeLobbyChannel();

  constructor(id = 777) {
    super();
    this.id = id;
  }

  get channelMessages() {
    return this.channel.messages;
  }

  get channelMessageHandler() {
    return this.channel.handler;
  }

  set channelMessageHandler(handler: ((message: string) => Promise<null>) | undefined) {
    this.channel.handler = handler;
  }

  registerPlayer(user: BotUserLike, state = BanchoLobbyPlayerStates.NotReady) {
    if (typeof user.id !== "number") {
      throw new Error("FakeLobby.registerPlayer requires a numeric user id.");
    }

    const player = { user, state };
    this.players.set(user.id, player);
    return player;
  }

  setPlayerState(userId: number, state: symbol | Symbol) {
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

  async setMods(mods: unknown, freemod?: boolean) {
    const values = Array.isArray(mods)
      ? mods.map((mod) =>
          typeof mod === "object" && mod && "shortMod" in mod
            ? String((mod as { shortMod: string }).shortMod).toUpperCase()
            : String(mod),
        )
      : [String(mods)];

    this.modHistory.push(values);
    this.freemodHistory.push(freemod);
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

function setSeededBeatmapTotalObjects(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  ordinal: number,
  totalObjects: number,
) {
  db.$client
    .prepare(
      `
      UPDATE beatmap_metadata
      SET total_objects = ?
      WHERE beatmap_id = (
        SELECT beatmap_id
        FROM beatmaps
        WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
          AND ordinal = ?
      )
      `,
    )
    .run(totalObjects, SEEDED_COURSE_SLUG, ordinal);
}

function setSeededBeatmapFreemod(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  ordinal: number,
  freemod: boolean,
) {
  db.$client
    .prepare(
      `
      UPDATE beatmaps
      SET freemod = ?
      WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
        AND ordinal = ?
      `,
    )
    .run(freemod ? 1 : 0, SEEDED_COURSE_SLUG, ordinal);
}

function setSeededBeatmapPassConditions(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  ordinal: number,
  conditions: unknown[],
) {
  db.$client
    .prepare(
      `
      UPDATE beatmaps
      SET pass_conditions = ?
      WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
        AND ordinal = ?
      `,
    )
    .run(JSON.stringify(conditions), SEEDED_COURSE_SLUG, ordinal);
}

function setSeededCourseOverallPassConditions(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  conditions: unknown[],
) {
  db.$client
    .prepare(
      `
      UPDATE courses
      SET overall_pass_conditions = ?
      WHERE slug = ?
      `,
    )
    .run(JSON.stringify(conditions), SEEDED_COURSE_SLUG);
}

function createSeededStartMessage(user: BotUserLike) {
  return createPrivateMessage(user, SEEDED_START_COMMAND);
}

function emitLobbyMessage(
  lobby: FakeLobby,
  user: BotUserLike,
  message: string,
  self = false,
) {
  lobby.channel.emit("message", { user, message, self });
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
        /Map 1\/2: beatmap .* with NM\. Starting in 0s\./.test(message),
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
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /course accuracy:/i);
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /score: 910,000 >= 10,000 required/.test(message),
      ),
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
      delete process.env.DOJO_SITE_URL;
    } else {
      process.env.DOJO_SITE_URL = originalSiteUrl;
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
        /score: 1,000,000 >= 999,999 required/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Targets: score >= 999,999/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /FreeMod allowed: NF optional, NM, HD, HR, HDHR/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /FreeMod active: add NF if you want the bot to receive your score after HP reaches 0\./.test(
          message,
        ),
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
        /Raw target on this map: >= 1,080,000 \(with DT\)/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /total score: 1,905,000 >= 1,900,000 required/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
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

test("bot announces exhausted final-map course miss budget", async () => {
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
        /Course target: 0 miss/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
    );
  } finally {
    temp.cleanup();
  }
});

test("bot still announces final course guidance after the course is already over budget", async () => {
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

    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /Course target: totalMissCount already exceeded \(1 \/ 0\)/.test(message),
      ),
      client.lobby.channelMessages.join("\n"),
    );
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
    const bot = createDojoBot({
      client,
      db,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      sleep: async () => {},
      fetchScore: async () => ({
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
    await waitForTimer(20);

    assert.ok(
      client.lobby.channelMessages.some((message) => /Disallowed mods: EZ/.test(message)),
    );

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const firstMap = results?.runs[0]?.maps[0];
    assert.equal(results?.runs[0]?.passed, false);
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
    assert.match(client.createLobbyCalls[0]?.name ?? "", /^osu!dojo/);
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

test("bot redirects skip sent over DM", async () => {
  const client = new FakeClient();
  const user = new FakeUser(42, "PlayerOne");
  const bot = createDojoBot({
    client,
    connectOnStart: false,
  });

  await bot.handlePrivateMessage(createPrivateMessage(user, "!dojo skip"));

  assert.equal(user.messages.at(-1), "Use !dojo skip in the multiplayer lobby chat.");
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

test("bot lobby skip starts the pending countdown exactly once", async () => {
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

    emitLobbyMessage(client.lobby, user, "!dojo skip");
    await refreshStarted.promise;
    emitLobbyMessage(client.lobby, user, "!dojo skip");
    await waitForTimer(1_100);

    assert.equal(client.lobby.startHistory.length, 0);

    releaseRefresh.resolve(null);
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 1);
    assert.equal(client.lobby.channelMessages.includes("!mp timer 1"), true);
    client.lobby.emit("matchStarted");
    await flushAsyncWork();
    emitLobbyMessage(client.lobby, user, "!dojo skip");
    await flushAsyncWork();
    assert.equal(client.lobby.startHistory.length, 1);
  } finally {
    releaseRefresh.resolve(null);
    temp.cleanup();
  }
});

test("bot lobby skip between maps advances to the next map immediately", async () => {
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

    emitLobbyMessage(client.lobby, user, "!dojo skip");
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 2);
  } finally {
    temp.cleanup();
  }
});

test("bot lobby skip aborts with missing-map when the target player has no map", async () => {
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

    emitLobbyMessage(client.lobby, user, "!dojo skip");
    await flushAsyncWork(6);

    assert.equal(client.lobby.startHistory.length, 0);
    assert.match(latestMeaningfulLobbyMessage(client.lobby), /do not have the map yet/i);
    assert.equal(endedEvents[0]?.result, "aborted");
    assert.equal(endedEvents[0]?.reason, "missing-map");
  } finally {
    temp.cleanup();
  }
});

test("bot lobby skip ignores non-owners and self echoes", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const client = new FakeClient();
    const target = new FakeUser(42, "PlayerOne");
    const other = new FakeUser(99, "PlayerTwo");
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

    emitLobbyMessage(client.lobby, other, "!dojo skip");
    emitLobbyMessage(client.lobby, target, "!dojo skip", true);
    await flushAsyncWork(6);

    assert.equal(other.messages.length, 0);
    assert.equal(client.lobby.startHistory.length, 0);
    assert.equal(bot.activeRunsByUserId.has(42), true);
  } finally {
    temp.cleanup();
  }
});

test("bot ignores non-skip dojo commands in the lobby channel", async () => {
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

    emitLobbyMessage(client.lobby, user, "!dojo help");
    emitLobbyMessage(client.lobby, user, "!dojo prev");
    emitLobbyMessage(client.lobby, user, SEEDED_START_COMMAND);
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

test("bot halts the course immediately when a map fails", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
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
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /accuracy: 100\.00% >= 99\.00% required/.test(message),
      ),
    );
    assert.ok(
      client.lobby.channelMessages.some((message) =>
        /miss: 30 <= 0 required/.test(message),
      ),
    );

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

test("bot fails a partial NF play even when the score clears threshold", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    setSeededBeatmapTotalObjects(db, 1, 710);

    const client = new FakeClient();
    const user = new FakeUser(42, "PlayerOne");
    const { entries, logger } = createCapturingLogger();
    const seededBeatmapIds = await getSeededBeatmapIds(db);
    let fetchCalls = 0;
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      restDurationMs: 0,
      firstMapCountdownSeconds: 0,
      finalGracePeriodMs: 0,
      fetchScore: async () => {
        fetchCalls += 1;
        return {
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
        };
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

    assert.equal(client.lobby.startHistory.length, 1);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(client.lobby.mapHistory, [seededBeatmapIds[0]]);
    assert.ok(
      client.lobby.channelMessages.some((message) => /partial play/i.test(message)),
    );
    assert.ok(
      entries.some(
        (entry) => entry.level === "warn" && entry.message === "dojo partial play detected",
      ),
    );

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
        return {
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
        };
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
    assert.ok(
      client.lobby.channelMessages.some((message) => /partial play - 399\/400/i.test(message)),
    );

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
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
    const bot = createDojoBot({
      client,
      db,
      logger,
      connectOnStart: false,
      restDurationMs: 0,
      finalGracePeriodMs: 0,
      firstMapCountdownSeconds: 0,
      fetchScore: async () => ({
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
    await waitForTimer(20);

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
      totalBudgetMs: number;
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
          totalBudgetMs: options.totalBudgetMs,
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
      { totalBudgetMs: 45_000, perCallTimeoutMs: 4_000, retryDelayMs: 2_500 },
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
    assert.equal(timeoutWarning.fields?.elapsedMs, 45_000);
    assert.equal(timeoutWarning.fields?.attempts, 16);
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
    assert.equal(scoreWarning.fields?.hadConfirmedFinish, false);
    assert.equal(scoreWarning.fields?.gameId, 17);
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
    assert.equal(scoreWarning.fields?.hadConfirmedFinish, true);
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
    assert.equal(interruptedWarning.fields?.hadConfirmedFinish, false);
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
    assert.equal(timeoutError.fields?.hadConfirmedFinish, true);
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
    assert.equal(interruptedWarning.fields?.cause, "api-timeout");
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
