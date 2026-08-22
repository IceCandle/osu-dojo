import { calculateAccuracy } from "@/lib/accuracy";
import { convertOsuApiModAcronyms } from "@/lib/mods";
import type { OsuApiClient } from "@/lib/osu/client";

export const MATCH_EVENT_LIMIT = 101;

export interface MatchWindowCursor {
  before?: number;
  after?: number;
}

export interface ModernMatchMod {
  acronym: string;
}

export interface ModernMatchScore {
  userId: number;
  legacyTotalScore: number;
  maxCombo: number;
  passed: boolean;
  statistics: {
    great: number;
    ok: number;
    meh: number;
    miss: number;
  };
  mods: ModernMatchMod[];
}

export interface ModernMatchGame {
  id: number;
  beatmapId: number;
  endTime: string | null;
  mods: ModernMatchMod[];
  scores: ModernMatchScore[];
}

export interface MatchEvent {
  id: number;
  game: ModernMatchGame | null;
}

export interface MatchEventWindow {
  events: MatchEvent[];
  rawEventCount: number;
  firstEventId: number;
  latestEventId: number;
  raw: unknown;
}

export interface NormalizedPlayerMapScore {
  gameId: number;
  beatmapId: number;
  userId: number;
  score: number;
  playerEnabledMods: number;
  globalGameMods: number;
  unknownModAcronyms?: {
    global: string[];
    player: string[];
  };
  accuracy: number;
  maxCombo: number;
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  passed: boolean;
}

export type MatchWindowFetcher = (
  cursor: MatchWindowCursor,
) => Promise<MatchEventWindow>;

export interface MatchGameLookupResult {
  game: ModernMatchGame | null;
  latestEventId: number | null;
  raw: unknown;
}

export async function fetchMatchEventWindow(
  client: OsuApiClient,
  matchId: number,
  options: {
    cursor?: MatchWindowCursor;
    deadline: number;
    perCallTimeoutMs: number;
  },
): Promise<MatchEventWindow> {
  const search = new URLSearchParams({ limit: String(MATCH_EVENT_LIMIT) });
  if (options.cursor?.before !== undefined) {
    search.set("before", String(options.cursor.before));
  }
  if (options.cursor?.after !== undefined) {
    search.set("after", String(options.cursor.after));
  }
  const payload = await client.requestJson<unknown>(
    `/api/v2/matches/${matchId}?${search.toString()}`,
    {
      rateLimit: "runCritical",
      deadline: options.deadline,
      perCallTimeoutMs: options.perCallTimeoutMs,
    },
  );
  return parseMatchEventWindow(payload);
}

export async function findLatestGame(
  options: {
    beatmapId: number;
    processedGameIds: ReadonlySet<number>;
    fetchWindow: MatchWindowFetcher;
    afterEventId?: number;
  },
): Promise<MatchGameLookupResult> {
  if (options.afterEventId !== undefined) {
    return findForward(options, options.afterEventId);
  }

  const latest = await options.fetchWindow({});
  const latestGame = findGameInWindow(
    latest,
    options.beatmapId,
    options.processedGameIds,
  );
  if (latestGame) {
    return {
      game: latestGame,
      latestEventId: latest.latestEventId,
      raw: latest.raw,
    };
  }

  let previousCursor: number | null = null;
  let before = latest.events[0]?.id;
  while (
    before !== undefined &&
    before > latest.firstEventId &&
    before !== previousCursor
  ) {
    previousCursor = before;
    const window = await options.fetchWindow({ before });
    const game = findGameInWindow(
      window,
      options.beatmapId,
      options.processedGameIds,
    );
    if (game) {
      return {
        game,
        latestEventId: latest.latestEventId,
        raw: window.raw,
      };
    }
    if (window.rawEventCount === 0) {
      break;
    }
    const nextBefore = window.events[0]?.id;
    if (
      nextBefore === undefined ||
      nextBefore <= window.firstEventId ||
      nextBefore >= before
    ) {
      break;
    }
    before = nextBefore;
  }

  return {
    game: null,
    latestEventId: latest.latestEventId,
    raw: latest.raw,
  };
}

export function normalizeModernPlayerScore(
  game: ModernMatchGame,
  playerScore: ModernMatchScore,
): NormalizedPlayerMapScore {
  const globalAcronyms = game.mods.map((mod) => mod.acronym.toUpperCase());
  const globalSet = new Set(globalAcronyms);
  const playerAcronyms = playerScore.mods
    .map((mod) => mod.acronym.toUpperCase())
    .filter((acronym) => !globalSet.has(acronym));
  const globalMods = convertOsuApiModAcronyms(globalAcronyms);
  const playerMods = convertOsuApiModAcronyms(playerAcronyms);
  const count300 = playerScore.statistics.great;
  const count100 = playerScore.statistics.ok;
  const count50 = playerScore.statistics.meh;
  const countMiss = playerScore.statistics.miss;

  return {
    gameId: game.id,
    beatmapId: game.beatmapId,
    userId: playerScore.userId,
    score: playerScore.legacyTotalScore,
    playerEnabledMods: playerMods.bitmask,
    globalGameMods: globalMods.bitmask,
    unknownModAcronyms: {
      global: globalMods.unknownAcronyms,
      player: playerMods.unknownAcronyms,
    },
    accuracy: calculateAccuracy({ count300, count100, count50, countMiss }),
    maxCombo: playerScore.maxCombo,
    count300,
    count100,
    count50,
    countMiss,
    passed: playerScore.passed,
  };
}

export function parseMatchEventWindow(payload: unknown): MatchEventWindow {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload["events"]) ||
    typeof payload["first_event_id"] !== "number" ||
    !Number.isSafeInteger(payload["first_event_id"]) ||
    typeof payload["latest_event_id"] !== "number" ||
    !Number.isSafeInteger(payload["latest_event_id"])
  ) {
    throw new Error("match payload: invalid shape");
  }

  return {
    events: payload["events"].flatMap((value) => {
      const event = parseEvent(value);
      return event === null ? [] : [event];
    }),
    rawEventCount: payload["events"].length,
    firstEventId: payload["first_event_id"],
    latestEventId: payload["latest_event_id"],
    raw: payload,
  };
}

async function findForward(
  options: {
    beatmapId: number;
    processedGameIds: ReadonlySet<number>;
    fetchWindow: MatchWindowFetcher;
  },
  initialAfter: number,
): Promise<MatchGameLookupResult> {
  let after = initialAfter;
  let latestEventId = initialAfter;
  let raw: unknown = null;

  while (true) {
    const window = await options.fetchWindow({ after });
    raw = window.raw;
    const game = findGameInWindow(
      window,
      options.beatmapId,
      options.processedGameIds,
    );
    latestEventId = Math.max(latestEventId, window.latestEventId);
    if (game) {
      return { game, latestEventId, raw };
    }
    if (
      window.rawEventCount < MATCH_EVENT_LIMIT ||
      window.latestEventId <= after
    ) {
      return { game: null, latestEventId, raw };
    }
    const nextAfter = window.events.at(-1)?.id;
    if (nextAfter === undefined || nextAfter <= after) {
      return { game: null, latestEventId, raw };
    }
    after = nextAfter;
  }
}

function findGameInWindow(
  window: MatchEventWindow,
  beatmapId: number,
  processedGameIds: ReadonlySet<number>,
) {
  return [...window.events]
    .reverse()
    .map((event) => event.game)
    .find(
      (game): game is ModernMatchGame =>
        game !== null &&
        game.beatmapId === beatmapId &&
        !processedGameIds.has(game.id),
    );
}

function parseEvent(value: unknown): MatchEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  let id: number;
  try {
    id = parseNonNegativeInteger(value["id"], "event.id");
  } catch {
    return null;
  }

  let game: ModernMatchGame | null = null;
  if (value["game"] !== null && value["game"] !== undefined) {
    try {
      game = parseGame(value["game"]);
    } catch {
      game = null;
    }
  }

  return {
    id,
    game,
  };
}

function parseGame(value: unknown): ModernMatchGame {
  if (!isRecord(value)) {
    throw new Error("match game: invalid shape");
  }
  const scores = value["scores"];
  return {
    id: parseNonNegativeInteger(value["id"], "game.id"),
    beatmapId: parseNonNegativeInteger(value["beatmap_id"], "game.beatmap_id"),
    endTime:
      value["end_time"] === null || value["end_time"] === undefined
        ? null
        : parseRequiredString(value["end_time"], "game.end_time"),
    mods: parseMods(value["mods"], "game.mods"),
    scores: scores === null || scores === undefined
      ? []
      : parseArray(scores, "game.scores").flatMap((score) => {
          try {
            return [parseScore(score)];
          } catch {
            return [];
          }
        }),
  };
}

function parseScore(value: unknown): ModernMatchScore {
  if (!isRecord(value) || !isRecord(value["statistics"])) {
    throw new Error("match score: invalid shape");
  }
  return {
    userId: parseNonNegativeInteger(value["user_id"], "score.user_id"),
    legacyTotalScore: parseNonNegativeInteger(
      value["legacy_total_score"],
      "score.legacy_total_score",
    ),
    maxCombo: parseNonNegativeInteger(value["max_combo"], "score.max_combo"),
    passed: parseBoolean(value["passed"], "score.passed"),
    statistics: {
      great: parseOptionalNonNegativeInteger(
        value["statistics"]["great"],
        "score.statistics.great",
      ),
      ok: parseOptionalNonNegativeInteger(
        value["statistics"]["ok"],
        "score.statistics.ok",
      ),
      meh: parseOptionalNonNegativeInteger(
        value["statistics"]["meh"],
        "score.statistics.meh",
      ),
      miss: parseOptionalNonNegativeInteger(
        value["statistics"]["miss"],
        "score.statistics.miss",
      ),
    },
    mods: parseMods(value["mods"], "score.mods"),
  };
}

function parseMods(value: unknown, field: string): ModernMatchMod[] {
  return parseArray(value, field).map((mod) => {
    if (typeof mod === "string") {
      return { acronym: mod };
    }
    if (isRecord(mod) && typeof mod["acronym"] === "string") {
      return { acronym: mod["acronym"] };
    }
    throw new Error(`${field}: invalid mod`);
  });
}

function parseArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field}: invalid array`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${field}: invalid integer`);
  }
  return value;
}

function parseOptionalNonNegativeInteger(value: unknown, field: string): number {
  return value === null || value === undefined
    ? 0
    : parseNonNegativeInteger(value, field);
}

function parseRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field}: invalid string`);
  }
  return value;
}

function parseBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${field}: invalid boolean`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
