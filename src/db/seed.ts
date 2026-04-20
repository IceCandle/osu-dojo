import path from "node:path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { loadCoursesFromDir, type DanSystemSeed } from "@/db/courseLoader";
import { beatmaps, courses, danSystems, mapResults, runs } from "@/db/schema";
import type { BeatmapMetadata, BeatmapResolutionResult } from "@/lib/beatmapMetadata";
import { sleep } from "@/lib/sleep";

type SeedDatabase = BetterSQLite3Database<typeof schema>;

const COURSE_DATA_DIR = path.join(process.cwd(), "data/courses");
const DEFAULT_METADATA_REQUEST_DELAY_MS = 200;

export interface SeedOptions {
  resolveMetadata?: (beatmapId: number) => Promise<BeatmapResolutionResult>;
  metadataRequestDelayMs?: number;
  suppressMissingObjectCountWarnings?: boolean;
}

type ExistingBeatmapMetadata = BeatmapMetadata & {
  beatmapId: number;
  totalObjects: number | null;
};

type SeedBeatmapData = {
  metadata: BeatmapMetadata;
  totalObjects: number | null;
};

export async function seedDatabase(
  db: SeedDatabase,
  systems = loadCoursesFromDir(COURSE_DATA_DIR),
  options: SeedOptions = {},
) {
  const metadataResolutionState = { requestCount: 0 };
  let missingObjectCountWithoutResolver = 0;

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

    for (const course of system.courses) {
      await db
        .insert(courses)
        .values({
          id: course.id,
          danSystemId: system.id,
          name: course.name,
          slug: course.slug,
          description: course.description,
          ordinal: course.ordinal,
          scoreModel: course.scoreModel,
          overallPassType: course.overallPassType,
          overallPassThreshold: course.overallPassThreshold,
        })
        .onConflictDoUpdate({
          target: courses.id,
          set: {
            danSystemId: system.id,
            name: course.name,
            slug: course.slug,
            description: course.description,
            ordinal: course.ordinal,
            scoreModel: course.scoreModel,
            overallPassType: course.overallPassType,
            overallPassThreshold: course.overallPassThreshold,
          },
        });

      const existingBeatmaps = await db
        .select({
          id: beatmaps.id,
          beatmapId: beatmaps.beatmapId,
          title: beatmaps.title,
          artist: beatmaps.artist,
          difficultyName: beatmaps.difficultyName,
          mapper: beatmaps.mapper,
          coverUrl: beatmaps.coverUrl,
          totalObjects: beatmaps.totalObjects,
        })
        .from(beatmaps)
        .where(eq(beatmaps.courseId, course.id));
      const existingMetadataById = new Map(
        existingBeatmaps.map((beatmap) => [beatmap.id, beatmap]),
      );
      const beatmapValues = [];

      for (const beatmap of course.beatmaps) {
        const beatmapData = await resolveSeedBeatmapData(
          beatmap,
          existingMetadataById.get(beatmap.id),
          options,
          metadataResolutionState,
        );

        if (!options.resolveMetadata && beatmapData.totalObjects === null) {
          missingObjectCountWithoutResolver += 1;
        }

        beatmapValues.push({
          id: beatmap.id,
          courseId: course.id,
          beatmapId: beatmap.beatmapId,
          mods: beatmap.mods,
          passConditionType: beatmap.passConditionType,
          passConditionThreshold: beatmap.passConditionThreshold,
          ordinal: beatmap.ordinal,
          title: beatmapData.metadata.title,
          artist: beatmapData.metadata.artist,
          difficultyName: beatmapData.metadata.difficultyName,
          mapper: beatmapData.metadata.mapper,
          coverUrl: beatmapData.metadata.coverUrl,
          totalObjects: beatmapData.totalObjects,
          annotations: JSON.stringify(beatmap.annotations),
        });
      }

      await db.delete(beatmaps).where(eq(beatmaps.courseId, course.id));
      await db.insert(beatmaps).values(beatmapValues);
    }
  }

  if (
    !options.suppressMissingObjectCountWarnings &&
    !options.resolveMetadata &&
    missingObjectCountWithoutResolver > 0
  ) {
    console.warn(
      `Unable to resolve object counts for ${missingObjectCountWithoutResolver} beatmap(s): no osu! API metadata resolver is configured.`,
    );
  }
}

export function cloneCourseSystems(systems: DanSystemSeed[]) {
  return systems.map((system) => ({
    ...system,
    courses: system.courses.map((course) => ({
      ...course,
      beatmaps: course.beatmaps.map((beatmap) => ({ ...beatmap })),
    })),
  }));
}

export async function clearAllData(
  db: SeedDatabase,
) {
  await db.delete(mapResults);
  await db.delete(runs);
  await db.delete(beatmaps);
  await db.delete(courses);
  await db.delete(danSystems);
}

async function resolveSeedBeatmapData(
  beatmap: DanSystemSeed["courses"][number]["beatmaps"][number],
  existing: ExistingBeatmapMetadata | undefined,
  options: SeedOptions,
  metadataResolutionState: { requestCount: number },
): Promise<SeedBeatmapData> {
  const seededMetadata = normalizeMetadata(beatmap);
  let metadata = hasCompleteMetadata(seededMetadata) ? seededMetadata : null;
  let totalObjects = hasReusableExistingTotalObjects(beatmap, existing)
    ? existing.totalObjects
    : null;

  if (metadata === null && hasReusableExistingMetadata(beatmap, existing)) {
    metadata = normalizeMetadata(existing);
  }

  const needsMetadata = metadata === null;
  const needsTotalObjects = totalObjects === null;

  if (!options.resolveMetadata || (!needsMetadata && !needsTotalObjects)) {
    return {
      metadata: metadata ?? emptyMetadata(),
      totalObjects,
    };
  }

  const delayMs = options.metadataRequestDelayMs ?? DEFAULT_METADATA_REQUEST_DELAY_MS;

  if (metadataResolutionState.requestCount > 0 && delayMs > 0) {
    await sleep(delayMs);
  }

  metadataResolutionState.requestCount += 1;
  const result = await options.resolveMetadata(beatmap.beatmapId);

  if (result.ok) {
    if (metadata === null && result.data.metadata !== null) {
      metadata = result.data.metadata;
    }
    if (totalObjects === null && result.data.totalObjects !== null) {
      totalObjects = result.data.totalObjects;
    }
  }

  warnIfUnresolved({
    needed: needsMetadata,
    resolved: result.ok && result.data.metadata !== null,
    beatmapId: beatmap.beatmapId,
    label: "metadata",
    missingFieldsMessage: "osu! API metadata did not include display fields",
    result,
  });

  warnIfUnresolved({
    needed: needsTotalObjects && !options.suppressMissingObjectCountWarnings,
    resolved: result.ok && result.data.totalObjects !== null,
    beatmapId: beatmap.beatmapId,
    label: "object counts",
    missingFieldsMessage: "osu! API metadata did not include object counts",
    result,
  });

  return {
    metadata: metadata ?? emptyMetadata(),
    totalObjects,
  };
}

function hasReusableExistingMetadata(
  beatmap: DanSystemSeed["courses"][number]["beatmaps"][number],
  existing: ExistingBeatmapMetadata | undefined,
): existing is ExistingBeatmapMetadata {
  return (
    existing !== undefined &&
    existing.beatmapId === beatmap.beatmapId &&
    hasCompleteMetadata(normalizeMetadata(existing))
  );
}

function hasReusableExistingTotalObjects(
  beatmap: DanSystemSeed["courses"][number]["beatmaps"][number],
  existing: ExistingBeatmapMetadata | undefined,
): existing is ExistingBeatmapMetadata & { totalObjects: number } {
  const totalObjects = existing?.totalObjects;

  return (
    existing !== undefined &&
    existing.beatmapId === beatmap.beatmapId &&
    typeof totalObjects === "number" &&
    Number.isSafeInteger(totalObjects) &&
    totalObjects >= 0
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

function warnIfUnresolved(args: {
  needed: boolean;
  resolved: boolean;
  beatmapId: number;
  label: string;
  missingFieldsMessage: string;
  result: BeatmapResolutionResult;
}) {
  if (!args.needed || args.resolved) {
    return;
  }

  const reason = args.result.ok ? args.missingFieldsMessage : args.result.reason;
  console.warn(`Unable to resolve ${args.label} for beatmap ${args.beatmapId}: ${reason}`);
}
