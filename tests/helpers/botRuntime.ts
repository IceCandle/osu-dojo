import { EventEmitter } from "node:events";
import { BanchoLobbyPlayerStates } from "bancho.js";
import type { BotLogger } from "@/bot/logger";
import { createTestDatabase } from "@/db/client";
import { getCourseByNameKey, listOpenLobbies } from "@/db/queries";
import { createTempDatabaseUrl as createTempDatabaseUrlWithPrefix } from "./tempDatabase";
import type {
  BanchoChannelLike,
  BotClientLike,
  BotUserLike,
  LobbyLike,
  PrivateMessageLike,
} from "@/bot/runtime";

export const createTempDatabaseUrl = () => createTempDatabaseUrlWithPrefix("osudojo-bot-");

export const SEEDED_SYSTEM_NAME_KEY = "test";
export const SEEDED_COURSE_NAME_KEY = "1st";
export const SEEDED_COURSE_SLUG = "test-1dan";
export const SEEDED_START_COMMAND = `!dojo start ${SEEDED_SYSTEM_NAME_KEY} ${SEEDED_COURSE_NAME_KEY}`;

export type FakeLobbyPlayer = {
  user: BotUserLike;
  state: Symbol;
};

export class FakeUser implements BotUserLike {
  id: number;
  username: string;
  ircUsername: string;
  messages: string[] = [];

  constructor(userId: number, username: string) {
    this.id = userId;
    this.username = username;
    this.ircUsername = username;
  }

  async fetchFromAPI() {
    return { id: this.id, username: this.username };
  }

  async sendMessage(message: string) {
    this.messages.push(message);
    return null;
  }
}

export class FakeLobbyChannel extends EventEmitter {
  messages: string[] = [];
  handler: ((message: string) => Promise<null>) | undefined;

  async sendMessage(message: string) {
    this.messages.push(message);
    if (this.handler) {
      return this.handler(message);
    }

    return null;
  }
}

export class FakeLobby extends EventEmitter implements LobbyLike {
  id: number;
  invites: string[] = [];
  lockHistory = 0;
  mapHistory: number[] = [];
  modHistory: string[][] = [];
  freemodHistory: Array<boolean | undefined> = [];
  settingsHistory: Array<{
    teamMode: number | undefined;
    winCondition: number | undefined;
    size: number | undefined;
  }> = [];
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

export class FakeCleanupChannel implements BanchoChannelLike {
  actions: string[] = [];
  joinError?: Error;
  closeError?: Error;
  leaveError?: Error;
  lobby?: { closeLobby: () => Promise<unknown> };

  constructor(options: { withLobby?: boolean } = { withLobby: true }) {
    if (options.withLobby ?? true) {
      this.lobby = {
        closeLobby: async () => {
          this.actions.push("closeLobby");
          if (this.closeError) {
            throw this.closeError;
          }
        },
      };
    }
  }

  async join() {
    this.actions.push("join");
    if (this.joinError) {
      throw this.joinError;
    }
  }

  async leave() {
    this.actions.push("leave");
    if (this.leaveError) {
      throw this.leaveError;
    }
  }

  async sendMessage(message: string) {
    this.actions.push(`sendMessage:${message}`);
  }
}

export class FakeClient extends EventEmitter implements BotClientLike {
  lobby = new FakeLobby();
  createLobbyCalls: Array<{ name: string; privateLobby: boolean | undefined }> = [];
  createLobbyHandler?: (
    name: string,
    privateLobby?: boolean,
  ) => Promise<{ lobby: FakeLobby }>;
  disconnectCalls = 0;
  connectCalls = 0;
  getChannelCalls: string[] = [];
  getChannelHandler?: (name: string) => BanchoChannelLike | undefined;

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

  getChannel(name: string) {
    this.getChannelCalls.push(name);
    return this.getChannelHandler?.(name);
  }
}

export function createPrivateMessage(user: BotUserLike, message: string): PrivateMessageLike {
  return { user, message, self: false };
}

export function createCapturingLogger() {
  const entries: Array<{
    level: "info" | "warn" | "error";
    message: string;
    fields: Record<string, unknown> | undefined;
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

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

export async function flushAsyncWork(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function waitForTimer(milliseconds: number, turns = 6) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  await flushAsyncWork(turns);
}

export function latestMeaningfulLobbyMessage(lobby: FakeLobby) {
  return (
    [...lobby.channelMessages]
      .reverse()
      .find(
        (message) =>
          !/^Lobby closing in \d+s\.$/i.test(message) && !/^!mp /i.test(message),
      ) ?? ""
  );
}

export async function getSeededBeatmapIds(db: Awaited<ReturnType<typeof createTestDatabase>>["db"]) {
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

export function setSeededBeatmapTotalObjects(
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

export function setSeededBeatmapFreemod(
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

export function setSeededBeatmapPassConditions(
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

export async function getOpenLobbyRows(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
) {
  return listOpenLobbies(db);
}

export function setSeededCourseOverallPassConditions(
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

export function createSeededStartMessage(user: BotUserLike) {
  return createPrivateMessage(user, SEEDED_START_COMMAND);
}

export function emitLobbyMessage(
  lobby: FakeLobby,
  user: BotUserLike,
  message: string,
  self = false,
) {
  lobby.channel.emit("message", { user, message, self });
}
