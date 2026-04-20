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

interface OsuBeatmapApiRecord {
  beatmapset_id?: unknown;
  title?: unknown;
  artist?: unknown;
  version?: unknown;
  creator?: unknown;
  count_normal?: unknown;
  count_slider?: unknown;
  count_spinner?: unknown;
}

export async function fetchBeatmapMetadata(
  apiKey: string,
  beatmapId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<BeatmapResolutionResult> {
  const url = new URL("https://osu.ppy.sh/api/get_beatmaps");
  url.searchParams.set("k", apiKey);
  url.searchParams.set("b", String(beatmapId));

  try {
    const response = await fetchImpl(url);

    if (!response.ok) {
      return {
        ok: false,
        reason: `osu! API returned ${response.status} for beatmap ${beatmapId}.`,
      };
    }

    const payload: unknown = await response.json();

    if (!Array.isArray(payload)) {
      return {
        ok: false,
        reason: `osu! API returned malformed metadata for beatmap ${beatmapId}.`,
      };
    }

    const record = payload[0] as OsuBeatmapApiRecord | undefined;

    if (!record) {
      return {
        ok: false,
        reason: `osu! API returned no metadata for beatmap ${beatmapId}.`,
      };
    }

    const metadata = parseDisplayMetadata(record);
    const totalObjects = parseTotalObjects(record);

    if (metadata === null && totalObjects === null) {
      return {
        ok: false,
        reason: `osu! API metadata was incomplete for beatmap ${beatmapId}.`,
      };
    }

    return { ok: true, data: { metadata, totalObjects } };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error
        ? error.message
        : `Unable to fetch metadata for beatmap ${beatmapId}.`,
    };
  }
}

function parseDisplayMetadata(record: OsuBeatmapApiRecord): BeatmapMetadata | null {
  const beatmapsetId = parsePositiveInteger(record.beatmapset_id);
  const title = parseRequiredString(record.title);
  const artist = parseRequiredString(record.artist);
  const difficultyName = parseRequiredString(record.version);
  const mapper = parseRequiredString(record.creator);

  if (!beatmapsetId || !title || !artist || !difficultyName || !mapper) {
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

function parseTotalObjects(record: OsuBeatmapApiRecord): number | null {
  const circles = parseNonNegativeInteger(record.count_normal);
  const sliders = parseNonNegativeInteger(record.count_slider);
  const spinners = parseNonNegativeInteger(record.count_spinner);

  if (circles === null || sliders === null || spinners === null) {
    return null;
  }

  return circles + sliders + spinners;
}

function parseRequiredString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return null;
    }
    value = trimmed;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
