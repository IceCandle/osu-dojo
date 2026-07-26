import {
  getDefaultOsuApiClient,
  type OsuApiClient,
  type OsuRateLimit,
} from "@/lib/osu/client";

const MAX_BEATMAP_IDS_PER_REQUEST = 50;
const DEFAULT_METADATA_DEADLINE_MS = 60_000;
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

export interface BeatmapMetadata {
  title: string;
  artist: string;
  difficultyName: string;
  mapper: string;
  coverUrl: string;
}

export interface ResolvedBeatmapData {
  metadata: BeatmapMetadata | null;
  totalObjects: number | null;
}

export type BeatmapResolutionResult =
  | { ok: true; data: ResolvedBeatmapData }
  | { ok: false; reason: string };

interface OsuBeatmapRecord {
  id?: unknown;
  beatmapset_id?: unknown;
  version?: unknown;
  count_circles?: unknown;
  count_sliders?: unknown;
  count_spinners?: unknown;
  beatmapset?: unknown;
}

export interface FetchBeatmapsOptions {
  client?: OsuApiClient;
  deadline?: number;
  perCallTimeoutMs?: number;
  rateLimit?: OsuRateLimit;
  now?: () => number;
  throwOnRequestError?: boolean;
}

export async function fetchBeatmapMetadataBatch(
  beatmapIds: readonly number[],
  options: FetchBeatmapsOptions = {},
): Promise<Map<number, BeatmapResolutionResult>> {
  const client = options.client ?? getDefaultOsuApiClient();
  const now = options.now ?? Date.now;
  const perCallTimeoutMs = options.perCallTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const rateLimit = options.rateLimit ?? "metadata";
  const uniqueIds = [...new Set(beatmapIds)];
  const results = new Map<number, BeatmapResolutionResult>();

  for (let index = 0; index < uniqueIds.length; index += MAX_BEATMAP_IDS_PER_REQUEST) {
    const chunk = uniqueIds.slice(index, index + MAX_BEATMAP_IDS_PER_REQUEST);
    const search = new URLSearchParams();
    for (const beatmapId of chunk) {
      search.append("ids[]", String(beatmapId));
    }

    let payload: unknown;
    try {
      const deadline = options.deadline ?? now() + DEFAULT_METADATA_DEADLINE_MS;
      payload = await client.requestJson<unknown>(
        `/api/v2/beatmaps?${search.toString()}`,
        {
          rateLimit,
          deadline,
          perCallTimeoutMs,
        },
      );
    } catch (error) {
      if (options.throwOnRequestError) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      for (const beatmapId of chunk) {
        results.set(beatmapId, { ok: false, reason });
      }
      continue;
    }

    const records = parseBeatmapRecords(payload);
    if (records === null) {
      for (const beatmapId of chunk) {
        results.set(beatmapId, {
          ok: false,
          reason: `osu! API returned malformed metadata for beatmap ${beatmapId}.`,
        });
      }
      continue;
    }

    const recordsById = new Map<number, OsuBeatmapRecord>();
    for (const record of records) {
      const id = parsePositiveInteger(record.id);
      if (id !== null) {
        recordsById.set(id, record);
      }
    }

    for (const beatmapId of chunk) {
      const record = recordsById.get(beatmapId);
      results.set(
        beatmapId,
        record
          ? normalizeBeatmap(record, beatmapId)
          : {
              ok: false,
              reason: `osu! API returned no metadata for beatmap ${beatmapId}.`,
            },
      );
    }
  }

  return results;
}

export async function fetchBeatmapMetadataV2(
  beatmapId: number,
  options: FetchBeatmapsOptions = {},
): Promise<BeatmapResolutionResult> {
  const results = await fetchBeatmapMetadataBatch([beatmapId], options);
  return (
    results.get(beatmapId) ?? {
      ok: false,
      reason: `osu! API returned no metadata for beatmap ${beatmapId}.`,
    }
  );
}

function normalizeBeatmap(
  record: OsuBeatmapRecord,
  beatmapId: number,
): BeatmapResolutionResult {
  const metadata = parseDisplayMetadata(record);
  const totalObjects = parseTotalObjects(record);

  if (metadata === null && totalObjects === null) {
    return {
      ok: false,
      reason: `osu! API metadata was incomplete for beatmap ${beatmapId}.`,
    };
  }

  return { ok: true, data: { metadata, totalObjects } };
}

function parseBeatmapRecords(payload: unknown): OsuBeatmapRecord[] | null {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload["beatmaps"]) ||
    !payload["beatmaps"].every(isRecord)
  ) {
    return null;
  }
  return payload["beatmaps"] as OsuBeatmapRecord[];
}

function parseDisplayMetadata(record: OsuBeatmapRecord): BeatmapMetadata | null {
  const beatmapsetId = parsePositiveInteger(record.beatmapset_id);
  const difficultyName = parseRequiredString(record.version);
  if (!beatmapsetId || !difficultyName || !isRecord(record.beatmapset)) {
    return null;
  }

  const title = parseRequiredString(record.beatmapset["title"]);
  const artist = parseRequiredString(record.beatmapset["artist"]);
  const mapper = parseRequiredString(record.beatmapset["creator"]);
  if (!title || !artist || !mapper) {
    return null;
  }

  return {
    title,
    artist,
    difficultyName,
    mapper,
    coverUrl: `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/cover.jpg`,
  };
}

function parseTotalObjects(record: OsuBeatmapRecord): number | null {
  const circles = parseNonNegativeInteger(record.count_circles);
  const sliders = parseNonNegativeInteger(record.count_sliders);
  const spinners = parseNonNegativeInteger(record.count_spinners);
  return circles === null || sliders === null || spinners === null
    ? null
    : circles + sliders + spinners;
}

function parseRequiredString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
