import process from "node:process";
import { pathToFileURL } from "node:url";
import { asc, eq, isNull, or } from "drizzle-orm";
import { getDatabase, type AppDatabase } from "@/db/client";
import { beatmapMetadata, beatmaps } from "@/db/schema";
import { fetchBeatmapMetadataBatch } from "@/lib/osu/beatmaps";
import { loadRepositoryEnv } from "@/lib/env";

export async function backfillBeatmapMetadata(
  db: AppDatabase,
  options: {
    fetchBatch?: typeof fetchBeatmapMetadataBatch;
    now?: () => number;
  } = {},
) {
  const fetchBatch = options.fetchBatch ?? fetchBeatmapMetadataBatch;
  const now = options.now ?? Date.now;
  const rows = await db
    .selectDistinct({
      beatmapId: beatmaps.beatmapId,
      title: beatmapMetadata.title,
      artist: beatmapMetadata.artist,
      difficultyName: beatmapMetadata.difficultyName,
      mapper: beatmapMetadata.mapper,
      coverUrl: beatmapMetadata.coverUrl,
      totalObjects: beatmapMetadata.totalObjects,
    })
    .from(beatmaps)
    .leftJoin(
      beatmapMetadata,
      eq(beatmaps.beatmapId, beatmapMetadata.beatmapId),
    )
    .where(
      or(
        isNull(beatmapMetadata.beatmapId),
        eq(beatmapMetadata.title, ""),
        eq(beatmapMetadata.artist, ""),
        eq(beatmapMetadata.difficultyName, ""),
        eq(beatmapMetadata.mapper, ""),
        eq(beatmapMetadata.coverUrl, ""),
        isNull(beatmapMetadata.totalObjects),
      ),
    )
    .orderBy(asc(beatmaps.beatmapId));
  const beatmapIds = rows.map((row) => row.beatmapId);
  const results = await fetchBatch(beatmapIds);
  let updated = 0;
  const failures: Array<{ beatmapId: number; reason: string }> = [];

  for (const row of rows) {
    const beatmapId = row.beatmapId;
    const result = results.get(beatmapId);
    if (!result?.ok) {
      failures.push({
        beatmapId,
        reason: result?.reason ?? "No metadata result was returned.",
      });
      continue;
    }
    const metadata = result.data.metadata;
    const values = {
      beatmapId,
      title: metadata?.title || row.title || "",
      artist: metadata?.artist || row.artist || "",
      difficultyName: metadata?.difficultyName || row.difficultyName || "",
      mapper: metadata?.mapper || row.mapper || "",
      coverUrl: metadata?.coverUrl || row.coverUrl || "",
      totalObjects: result.data.totalObjects ?? row.totalObjects,
      fetchedAt: now(),
    };
    await db
      .insert(beatmapMetadata)
      .values(values)
      .onConflictDoUpdate({
        target: beatmapMetadata.beatmapId,
        set: values,
      });
    if (!hasCompleteMetadata(values)) {
      failures.push({
        beatmapId,
        reason: `Metadata remained incomplete for beatmap ${beatmapId}.`,
      });
      continue;
    }
    updated += 1;
  }

  return { requested: beatmapIds.length, updated, failures };
}

async function main() {
  loadRepositoryEnv();
  const db = await getDatabase();
  const result = await backfillBeatmapMetadata(db);
  console.log(
    `Metadata backfill finished: ${result.updated}/${result.requested} beatmap(s) updated.`,
  );
  for (const failure of result.failures) {
    console.warn(`Beatmap ${failure.beatmapId}: ${failure.reason}`);
  }
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

function hasCompleteMetadata(values: {
  title: string;
  artist: string;
  difficultyName: string;
  mapper: string;
  coverUrl: string;
  totalObjects: number | null;
}) {
  return (
    values.title.trim() !== "" &&
    values.artist.trim() !== "" &&
    values.difficultyName.trim() !== "" &&
    values.mapper.trim() !== "" &&
    values.coverUrl.trim() !== "" &&
    values.totalObjects !== null
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
