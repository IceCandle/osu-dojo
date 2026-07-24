import path from "node:path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { loadCoursesFromDir, type DanSystemSeed } from "@/db/courseLoader";
import {
  beatmapMetadata,
  beatmaps,
  courses,
  danSystems,
  homepageFeaturedCourses,
  mapResults,
  runs,
} from "@/db/schema";
import type { BeatmapMetadata, BeatmapResolutionResult } from "@/lib/beatmapMetadata";
import { systemCapabilities, type DanSystemStatus } from "@/lib/domain";
import { kebabizeName } from "@/lib/format";
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
    const existingSystem = await db.query.danSystems.findFirst({
      where: eq(danSystems.id, system.id),
    });
    const existingSystemCourses = existingSystem
      ? await db.select().from(courses).where(eq(courses.danSystemId, system.id))
      : [];
    await assertAllowedSystemChange(
      db,
      existingSystem,
      existingSystemCourses,
      system,
    );

    await db
      .insert(danSystems)
      .values({
        id: system.id,
        name: system.name,
        slug: system.slug,
        description: system.description,
        status: system.status,
        ladder: system.ladder ?? null,
        ladderOrder: system.ladderOrder ?? 0,
      })
      .onConflictDoUpdate({
        target: danSystems.id,
        set: {
          name: system.name,
          slug: system.slug,
          description: system.description,
          status: system.status,
          ladder: system.ladder ?? null,
          ladderOrder: system.ladderOrder ?? 0,
        },
      });

    for (const course of system.courses) {
      const existingCourse = await db.query.courses.findFirst({
        where: eq(courses.id, course.id),
      });
      const existingCourseForSlug = await db.query.courses.findFirst({
        where: (fields, { and }) =>
          and(eq(fields.danSystemId, system.id), eq(fields.slug, course.slug)),
      });

      if (existingCourseForSlug && existingCourseForSlug.id !== course.id) {
        throw new Error(
          `Course slug "${course.slug}" in system "${system.name}" is already used by "${existingCourseForSlug.id}".`,
        );
      }

      if (existingCourse) {
        if (existingCourse.danSystemId !== system.id) {
          throw new Error(`Course "${course.id}" cannot move between dan systems.`);
        }
      }

      await db
        .insert(courses)
        .values({
          id: course.id,
          danSystemId: system.id,
          creatorUserId: null,
          name: course.name,
          slug: course.slug,
          description: course.description,
          tags: JSON.stringify(course.tags),
          ordinal: course.ordinal,
          official: course.official ?? false,
          label: course.label ?? null,
          scoreModel: course.scoreModel,
          overallPassConditions: JSON.stringify(course.overallPassConditions),
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: courses.id,
          set: {
            name: course.name,
            slug: course.slug,
            description: course.description,
            tags: JSON.stringify(course.tags),
            ordinal: course.ordinal,
            official: course.official ?? false,
            label: course.label ?? null,
            scoreModel: course.scoreModel,
            overallPassConditions: JSON.stringify(course.overallPassConditions),
            updatedAt: Date.now(),
          },
        });

      const existingMetadataRows = await db.select().from(beatmapMetadata);
      const existingMetadataById = new Map(
        existingMetadataRows.map((metadata) => [metadata.beatmapId, metadata]),
      );
      const beatmapValues = [];

      for (const beatmap of course.beatmaps) {
        const beatmapData = await resolveSeedBeatmapData(
          beatmap,
          existingMetadataById.get(beatmap.beatmapId),
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
          freemod: beatmap.freemod,
          passConditions: JSON.stringify(beatmap.passConditions),
          ordinal: beatmap.ordinal,
          annotations: JSON.stringify(beatmap.annotations),
        });

        await db
          .insert(beatmapMetadata)
          .values({
            beatmapId: beatmap.beatmapId,
            title: beatmapData.metadata.title,
            artist: beatmapData.metadata.artist,
            difficultyName: beatmapData.metadata.difficultyName,
            mapper: beatmapData.metadata.mapper,
            coverUrl: beatmapData.metadata.coverUrl,
            totalObjects: beatmapData.totalObjects,
            fetchedAt: Date.now(),
          })
          .onConflictDoUpdate({
            target: beatmapMetadata.beatmapId,
            set: {
              title: beatmapData.metadata.title,
              artist: beatmapData.metadata.artist,
              difficultyName: beatmapData.metadata.difficultyName,
              mapper: beatmapData.metadata.mapper,
              coverUrl: beatmapData.metadata.coverUrl,
              totalObjects: beatmapData.totalObjects,
              fetchedAt: Date.now(),
            },
          });
      }

      if (!existingSystem || !systemCapabilities(existingSystem.status).frozen) {
        await db.delete(beatmaps).where(eq(beatmaps.courseId, course.id));
        await db.insert(beatmaps).values(beatmapValues);
      }
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
      overallPassConditions: course.overallPassConditions.map((condition) => ({
        ...condition,
      })),
      beatmaps: course.beatmaps.map((beatmap) => ({
        ...beatmap,
        passConditions: beatmap.passConditions.map((condition) => ({ ...condition })),
      })),
    })),
  }));
}

export async function clearAllData(
  db: SeedDatabase,
) {
  await db.delete(mapResults);
  await db.delete(runs);
  await db.delete(beatmaps);
  await db.delete(beatmapMetadata);
  await db.delete(homepageFeaturedCourses);
  await db.delete(courses);
  await db.delete(danSystems);
}

async function assertAllowedSystemChange(
  db: SeedDatabase,
  existingSystem: typeof danSystems.$inferSelect | undefined,
  existingCourses: Array<typeof courses.$inferSelect>,
  system: DanSystemSeed,
) {
  if (!existingSystem) {
    return;
  }

  assertAllowedStatusTransition(existingSystem.status, system.status, system.id);

  const oldSystemKey = kebabizeName(existingSystem.name);
  const newSystemKey = kebabizeName(system.name);
  const isRolloverRename =
    existingSystem.status === "current" && system.status === "legacy";
  if (oldSystemKey !== newSystemKey && !isRolloverRename) {
    throw new Error(
      `System "${system.id}" changed public name key from "${oldSystemKey}" to "${newSystemKey}". System name-key changes are only allowed during current to legacy rollover.`,
    );
  }

  if (!systemCapabilities(existingSystem.status).frozen) {
    return;
  }

  const existingCourseIds = new Set(existingCourses.map((course) => course.id));
  const incomingCourseIds = new Set(system.courses.map((course) => course.id));
  if (!setsEqual(existingCourseIds, incomingCourseIds)) {
    throw new Error(
      `System "${system.id}" is ${existingSystem.status}; course add/remove is immutable after publish.`,
    );
  }

  const existingCoursesById = new Map(
    existingCourses.map((course) => [course.id, course]),
  );
  for (const course of system.courses) {
    const existingCourse = existingCoursesById.get(course.id);
    if (!existingCourse) {
      continue;
    }

    const existingBeatmaps = await db
      .select({
        id: beatmaps.id,
        beatmapId: beatmaps.beatmapId,
        mods: beatmaps.mods,
        freemod: beatmaps.freemod,
        passConditions: beatmaps.passConditions,
        ordinal: beatmaps.ordinal,
      })
      .from(beatmaps)
      .where(eq(beatmaps.courseId, course.id));
    const changedFields = getGameplayChangedFields(
      existingCourse,
      existingBeatmaps,
      course,
    );
    if (changedFields.length > 0) {
      throw new Error(
        `System "${system.id}" is ${existingSystem.status}; course "${course.id}" has immutable gameplay changes: ${changedFields.join(
          ", ",
        )}. Create a new system version for gameplay changes.`,
      );
    }
  }
}

function assertAllowedStatusTransition(
  existingStatus: DanSystemStatus,
  incomingStatus: DanSystemStatus,
  systemId: string,
) {
  if (existingStatus === incomingStatus) {
    return;
  }

  const allowed =
    (existingStatus === "draft" &&
      (incomingStatus === "current" || incomingStatus === "archived")) ||
    (existingStatus === "current" &&
      (incomingStatus === "legacy" || incomingStatus === "archived")) ||
    (existingStatus === "legacy" &&
      (incomingStatus === "current" || incomingStatus === "archived"));

  if (!allowed) {
    throw new Error(
      `System "${systemId}" cannot transition from ${existingStatus} to ${incomingStatus}.`,
    );
  }
}

function getGameplayChangedFields(
  existingCourse: typeof courses.$inferSelect,
  existingBeatmaps: Array<{
    id: string;
    beatmapId: number;
    mods: string;
    freemod: boolean;
    passConditions: string;
    ordinal: number;
  }>,
  course: DanSystemSeed["courses"][number],
) {
  const changedFields = [];

  if (existingCourse.ordinal !== course.ordinal) {
    changedFields.push("ordinal");
  }
  if (existingCourse.slug !== course.slug) {
    changedFields.push("slug");
  }
  if (kebabizeName(existingCourse.name) !== kebabizeName(course.name)) {
    changedFields.push("nameKey");
  }
  if (existingCourse.scoreModel !== course.scoreModel) {
    changedFields.push("scoreModel");
  }
  if (
    existingCourse.overallPassConditions !== JSON.stringify(course.overallPassConditions)
  ) {
    changedFields.push("overallPassConditions");
  }

  const existingSignature = existingBeatmaps
    .map((beatmap) => ({
      id: beatmap.id,
      beatmapId: beatmap.beatmapId,
      mods: beatmap.mods,
      freemod: beatmap.freemod,
      passConditions: beatmap.passConditions,
      ordinal: beatmap.ordinal,
    }))
    .sort(compareBeatmapSignatures);
  const nextSignature = course.beatmaps
    .map((beatmap) => ({
      id: beatmap.id,
      beatmapId: beatmap.beatmapId,
      mods: beatmap.mods,
      freemod: beatmap.freemod,
      passConditions: JSON.stringify(beatmap.passConditions),
      ordinal: beatmap.ordinal,
    }))
    .sort(compareBeatmapSignatures);

  if (JSON.stringify(existingSignature) !== JSON.stringify(nextSignature)) {
    changedFields.push("beatmaps");
  }

  return changedFields;
}

function setsEqual<T>(left: Set<T>, right: Set<T>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function compareBeatmapSignatures(
  left: { ordinal: number; id: string },
  right: { ordinal: number; id: string },
) {
  return left.ordinal - right.ordinal || left.id.localeCompare(right.id);
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
