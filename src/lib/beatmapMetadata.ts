export interface BeatmapMetadata {
  title: string;
  artist: string;
  difficultyName: string;
  mapper: string;
  coverUrl: string;
}

export type MetadataResult =
  | { ok: true; data: BeatmapMetadata }
  | { ok: false; reason: string };

interface OsuBeatmapApiRecord {
  beatmapset_id?: unknown;
  title?: unknown;
  artist?: unknown;
  version?: unknown;
  creator?: unknown;
}

export async function fetchBeatmapMetadata(
  apiKey: string,
  beatmapId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<MetadataResult> {
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

    const metadata = parseBeatmapMetadata(record);

    if (!metadata) {
      return {
        ok: false,
        reason: `osu! API metadata was incomplete for beatmap ${beatmapId}.`,
      };
    }

    return { ok: true, data: metadata };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error
        ? error.message
        : `Unable to fetch metadata for beatmap ${beatmapId}.`,
    };
  }
}

function parseBeatmapMetadata(record: OsuBeatmapApiRecord): BeatmapMetadata | null {
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
