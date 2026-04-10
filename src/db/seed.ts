import path from "node:path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { loadCoursesFromDir, type CourseSystemSeed } from "@/db/courseLoader";
import { danBeatmaps, dans, danSystems, mapResults, results } from "@/db/schema";

const now = 1_710_000_000_000;

const seedResult = {
  id: "result-demo-pass",
  userId: 124493,
  username: "DemoPlayer",
  danId: "dan-test-1dan",
  passed: true,
  startedAt: now - 180_000,
  completedAt: now,
  matchId: 4_242,
};

type SeedDatabase = BetterSQLite3Database<typeof schema>;

const COURSE_DATA_DIR = path.join(process.cwd(), "data/courses");

export async function seedDatabase(
  db: SeedDatabase,
  systems = loadCoursesFromDir(COURSE_DATA_DIR),
) {
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
          legacySlug: dan.courseSlug,
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
            legacySlug: dan.courseSlug,
            courseSlug: dan.courseSlug,
            description: dan.description,
            ordinal: dan.ordinal,
            scoreModel: dan.scoreModel,
            overallPassType: dan.overallPassType,
            overallPassThreshold: dan.overallPassThreshold,
          },
        });

      await db.delete(danBeatmaps).where(eq(danBeatmaps.danId, dan.id));
      await db.insert(danBeatmaps).values(
        dan.beatmaps.map((beatmap) => ({
          id: beatmap.id,
          danId: dan.id,
          beatmapId: beatmap.beatmapId,
          mods: beatmap.mods,
          passConditionType: beatmap.passConditionType,
          passConditionThreshold: beatmap.passConditionThreshold,
          ordinal: beatmap.ordinal,
          title: beatmap.title,
          artist: beatmap.artist,
          difficultyName: beatmap.difficultyName,
          mapper: beatmap.mapper,
          coverUrl: beatmap.coverUrl,
          annotations: JSON.stringify(beatmap.annotations),
        })),
      );
    }
  }

  const existingResult = await db
    .select({ id: results.id })
    .from(results)
    .where(eq(results.id, seedResult.id));

  if (existingResult.length > 0) {
    return;
  }

  const demoDan = systems
    .flatMap((system) => system.dans)
    .find((dan) => dan.id === seedResult.danId);

  if (!demoDan) {
    throw new Error(`Missing demo dan "${seedResult.danId}" in seeded course data.`);
  }

  const demoBeatmaps = [
    requireBeatmap(demoDan.beatmaps, 0, seedResult.danId),
    requireBeatmap(demoDan.beatmaps, 1, seedResult.danId),
  ] as const;

  await db.insert(results).values(seedResult);
  await db.insert(mapResults).values([
    {
      id: "result-demo-map-1",
      resultId: seedResult.id,
      gameId: 1,
      beatmapId: demoBeatmaps[0].beatmapId,
      mods: demoBeatmaps[0].mods,
      passConditionType: demoBeatmaps[0].passConditionType,
      passConditionThreshold: demoBeatmaps[0].passConditionThreshold,
      ordinal: 1,
      score: 918_222,
      accuracy: 96.41,
      maxCombo: 834,
      count300: 1074,
      count100: 42,
      count50: 5,
      countMiss: 2,
      passed: true,
      createdAt: now - 120_000,
    },
    {
      id: "result-demo-map-2",
      resultId: seedResult.id,
      gameId: 2,
      beatmapId: demoBeatmaps[1].beatmapId,
      mods: demoBeatmaps[1].mods,
      passConditionType: demoBeatmaps[1].passConditionType,
      passConditionThreshold: demoBeatmaps[1].passConditionThreshold,
      ordinal: 2,
      score: 906_510,
      accuracy: 95.16,
      maxCombo: 772,
      count300: 948,
      count100: 51,
      count50: 6,
      countMiss: 3,
      passed: true,
      createdAt: now - 70_000,
    },
  ]);
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

export async function resetSeedData(
  db: SeedDatabase,
) {
  await clearAllData(db);
  await seedDatabase(db);
}

function requireBeatmap<T>(
  beatmaps: T[],
  index: number,
  danId: string,
): T {
  const beatmap = beatmaps[index];

  if (!beatmap) {
    throw new Error(`Missing beatmap ${index + 1} for demo dan "${danId}".`);
  }

  return beatmap;
}
