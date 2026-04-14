import path from "node:path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { loadCoursesFromDir, type CourseSystemSeed } from "@/db/courseLoader";
import { danBeatmaps, dans, danSystems, mapResults, results } from "@/db/schema";
import type { BeatmapMetadata, MetadataResult } from "@/lib/beatmapMetadata";

type SeedDatabase = BetterSQLite3Database<typeof schema>;

const COURSE_DATA_DIR = path.join(process.cwd(), "data/courses");
const DEFAULT_METADATA_REQUEST_DELAY_MS = 200;

export interface SeedOptions {
  resolveMetadata?: (beatmapId: number) => Promise<MetadataResult>;
  metadataRequestDelayMs?: number;
}

type ExistingBeatmapMetadata = BeatmapMetadata & {
  beatmapId: number;
};

export async function seedDatabase(
  db: SeedDatabase,
  systems = loadCoursesFromDir(COURSE_DATA_DIR),
  options: SeedOptions = {},
) {
  const metadataResolutionState = { requestCount: 0 };

  for (const system of systems) {
    await db
      .insert(danSystems)
      .values({
        id: system.id,
        name: system.name,
        slug: system.slug,
        description: system.description,
      })
      .onConflictDoUpdate({
        target: danSystems.id,
        set: {
          name: system.name,
          slug: system.slug,
          description: system.description,
        },
      });

    for (const dan of system.dans) {
      await db
        .insert(dans)
        .values({
          id: dan.id,
          danSystemId: system.id,
          name: dan.name,
          courseSlug: dan.courseSlug,
          description: dan.description,
          ordinal: dan.ordinal,
          scoreModel: dan.scoreModel,
          overallPassType: dan.overallPassType,
          overallPassThreshold: dan.overallPassThreshold,
        })
        .onConflictDoUpdate({
          target: dans.id,
          set: {
            danSystemId: system.id,
            name: dan.name,
            courseSlug: dan.courseSlug,
            description: dan.description,
            ordinal: dan.ordinal,
            scoreModel: dan.scoreModel,
            overallPassType: dan.overallPassType,
            overallPassThreshold: dan.overallPassThreshold,
          },
        });

      const existingBeatmaps = await db
        .select({
          id: danBeatmaps.id,
          beatmapId: danBeatmaps.beatmapId,
          title: danBeatmaps.title,
          artist: danBeatmaps.artist,
          difficultyName: danBeatmaps.difficultyName,
          mapper: danBeatmaps.mapper,
          coverUrl: danBeatmaps.coverUrl,
        })
        .from(danBeatmaps)
        .where(eq(danBeatmaps.danId, dan.id));
      const existingMetadataById = new Map(
        existingBeatmaps.map((beatmap) => [beatmap.id, beatmap]),
      );
      const beatmapValues = [];

      for (const beatmap of dan.beatmaps) {
        const metadata = await resolveSeedBeatmapMetadata(
          beatmap,
          existingMetadataById.get(beatmap.id),
          options,
          metadataResolutionState,
        );

        beatmapValues.push({
          id: beatmap.id,
          danId: dan.id,
          beatmapId: beatmap.beatmapId,
          mods: beatmap.mods,
          passConditionType: beatmap.passConditionType,
          passConditionThreshold: beatmap.passConditionThreshold,
          ordinal: beatmap.ordinal,
          title: metadata.title,
          artist: metadata.artist,
          difficultyName: metadata.difficultyName,
          mapper: metadata.mapper,
          coverUrl: metadata.coverUrl,
          annotations: JSON.stringify(beatmap.annotations),
        });
      }

      await db.delete(danBeatmaps).where(eq(danBeatmaps.danId, dan.id));
      await db.insert(danBeatmaps).values(beatmapValues);
    }
  }
}

export function cloneCourseSystems(systems: CourseSystemSeed[]) {
  return systems.map((system) => ({
    ...system,
    dans: system.dans.map((dan) => ({
      ...dan,
      beatmaps: dan.beatmaps.map((beatmap) => ({ ...beatmap })),
    })),
  }));
}

export async function clearAllData(
  db: SeedDatabase,
) {
  await db.delete(mapResults);
  await db.delete(results);
  await db.delete(danBeatmaps);
  await db.delete(dans);
  await db.delete(danSystems);
}

async function resolveSeedBeatmapMetadata(
  beatmap: CourseSystemSeed["dans"][number]["beatmaps"][number],
  existing: ExistingBeatmapMetadata | undefined,
  options: SeedOptions,
  metadataResolutionState: { requestCount: number },
): Promise<BeatmapMetadata> {
  const seededMetadata = normalizeMetadata(beatmap);

  if (hasCompleteMetadata(seededMetadata)) {
    return seededMetadata;
  }

  if (hasReusableExistingMetadata(beatmap, existing)) {
    return normalizeMetadata(existing);
  }

  if (!options.resolveMetadata) {
    return emptyMetadata();
  }

  const delayMs = options.metadataRequestDelayMs ?? DEFAULT_METADATA_REQUEST_DELAY_MS;

  if (metadataResolutionState.requestCount > 0 && delayMs > 0) {
    await sleep(delayMs);
  }

  metadataResolutionState.requestCount += 1;
  const result = await options.resolveMetadata(beatmap.beatmapId);

  if (result.ok) {
    return result.data;
  }

  console.warn(
    `Unable to resolve metadata for beatmap ${beatmap.beatmapId}: ${result.reason}`,
  );

  return emptyMetadata();
}

function hasReusableExistingMetadata(
  beatmap: CourseSystemSeed["dans"][number]["beatmaps"][number],
  existing: ExistingBeatmapMetadata | undefined,
): existing is ExistingBeatmapMetadata {
  return (
    existing !== undefined &&
    existing.beatmapId === beatmap.beatmapId &&
    hasCompleteMetadata(normalizeMetadata(existing))
  );
}

function normalizeMetadata(metadata: Partial<BeatmapMetadata>): BeatmapMetadata {
  return {
    title: metadata.title ?? "",
    artist: metadata.artist ?? "",
    difficultyName: metadata.difficultyName ?? "",
    mapper: metadata.mapper ?? "",
    coverUrl: metadata.coverUrl ?? "",
  };
}

function hasCompleteMetadata(metadata: BeatmapMetadata): boolean {
  return Object.values(metadata).every((value) => value.trim() !== "");
}

function emptyMetadata(): BeatmapMetadata {
  return {
    title: "",
    artist: "",
    difficultyName: "",
    mapper: "",
    coverUrl: "",
  };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
