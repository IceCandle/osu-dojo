import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDatabase, type AppDatabase } from "@/db/client";
import { danBeatmaps, dans, danSystems, mapResults, results } from "@/db/schema";
import type {
  DanCourseDefinition,
  JudgedMapResult,
  StoredRunResult,
} from "@/lib/domain";

type DerivedRunStatus = "pass" | "fail" | "dnf";

async function useDb(db?: AppDatabase): Promise<AppDatabase> {
  return db ?? getDatabase();
}

export async function listDanSystemsWithDans(db?: AppDatabase) {
  const database = await useDb(db);
  const rows = await database
    .select({
      systemId: danSystems.id,
      systemName: danSystems.name,
      systemSlug: danSystems.slug,
      systemDescription: danSystems.description,
      danId: dans.id,
      danName: dans.name,
      danSlug: dans.slug,
      danDescription: dans.description,
      danOrdinal: dans.ordinal,
      overallPassType: dans.overallPassType,
      overallPassThreshold: dans.overallPassThreshold,
    })
    .from(danSystems)
    .leftJoin(dans, eq(dans.danSystemId, danSystems.id))
    .orderBy(asc(danSystems.name), asc(dans.ordinal));

  const systems = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      description: string;
      dans: Array<{
        id: string;
        name: string;
        slug: string;
        description: string;
        ordinal: number;
        overallPassType: DanCourseDefinition["overallPassType"];
        overallPassThreshold: number | null;
      }>;
    }
  >();

  for (const row of rows) {
    const existing = systems.get(row.systemId);
    const system =
      existing ??
      {
        id: row.systemId,
        name: row.systemName,
        slug: row.systemSlug,
        description: row.systemDescription,
        dans: [],
      };

    if (row.danId) {
      system.dans.push({
        id: row.danId,
        name: row.danName ?? "",
        slug: row.danSlug ?? "",
        description: row.danDescription ?? "",
        ordinal: row.danOrdinal ?? 0,
        overallPassType: row.overallPassType,
        overallPassThreshold: row.overallPassThreshold,
      });
    }

    systems.set(system.id, system);
  }

  return [...systems.values()];
}

export async function getDanCourseBySlug(
  slug: string,
  db?: AppDatabase,
): Promise<DanCourseDefinition | null> {
  const database = await useDb(db);
  const rows = await database
    .select({
      danId: dans.id,
      danName: dans.name,
      danSlug: dans.slug,
      danDescription: dans.description,
      danOrdinal: dans.ordinal,
      overallPassType: dans.overallPassType,
      overallPassThreshold: dans.overallPassThreshold,
      systemId: danSystems.id,
      systemName: danSystems.name,
    })
    .from(dans)
    .innerJoin(danSystems, eq(dans.danSystemId, danSystems.id))
    .where(eq(dans.slug, slug));

  const row = rows[0];
  if (!row) {
    return null;
  }

  const beatmaps = await database
    .select({
      id: danBeatmaps.id,
      beatmapId: danBeatmaps.beatmapId,
      mods: danBeatmaps.mods,
      passConditionType: danBeatmaps.passConditionType,
      passConditionThreshold: danBeatmaps.passConditionThreshold,
      ordinal: danBeatmaps.ordinal,
    })
    .from(danBeatmaps)
    .where(eq(danBeatmaps.danId, row.danId))
    .orderBy(asc(danBeatmaps.ordinal));

  return {
    id: row.danId,
    danSystemId: row.systemId,
    danSystemName: row.systemName,
    name: row.danName,
    slug: row.danSlug,
    description: row.danDescription,
    ordinal: row.danOrdinal,
    overallPassType: row.overallPassType,
    overallPassThreshold: row.overallPassThreshold,
    beatmaps,
  };
}

export async function listDanResultsBySlug(slug: string, db?: AppDatabase) {
  const database = await useDb(db);
  const course = await getDanCourseBySlug(slug, database);

  if (!course) {
    return null;
  }

  const resultRows = await database
    .select({
      id: results.id,
      userId: results.userId,
      username: results.username,
      danId: results.danId,
      passed: results.passed,
      startedAt: results.startedAt,
      completedAt: results.completedAt,
    })
    .from(results)
    .where(eq(results.danId, course.id))
    .orderBy(desc(results.completedAt))
    .limit(20);

  if (resultRows.length === 0) {
    return { course, results: [] };
  }

  const resultIds = resultRows.map((row) => row.id);
  const mapRows = await database
    .select()
    .from(mapResults)
    .where(inArray(mapResults.resultId, resultIds))
    .orderBy(asc(mapResults.ordinal), asc(mapResults.createdAt));

  const mapsByResultId = new Map<string, typeof mapRows>();
  for (const row of mapRows) {
    const bucket = mapsByResultId.get(row.resultId) ?? [];
    bucket.push(row);
    mapsByResultId.set(row.resultId, bucket);
  }

  return {
    course,
    results: resultRows.map((row) => {
      const maps = mapsByResultId.get(row.id) ?? [];
      return {
        ...row,
        maps,
        status: deriveRunStatus(row.passed, maps, course.beatmaps.length),
      };
    }),
  };
}

export async function storeDanRunResult(
  input: {
    userId: number;
    username: string;
    danId: string;
    passed: boolean;
    startedAt: number;
    completedAt: number;
    maps: Omit<JudgedMapResult, "id" | "resultId">[];
  },
  db?: AppDatabase,
): Promise<{ result: StoredRunResult; maps: JudgedMapResult[] }> {
  const database = await useDb(db);
  const resultId = randomUUID();
  const result = {
    id: resultId,
    userId: input.userId,
    username: input.username,
    danId: input.danId,
    passed: input.passed,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  } satisfies StoredRunResult;

  database.transaction((tx) => {
    tx.insert(results).values(result).run();
    tx.insert(mapResults).values(
      input.maps.map((map) => ({
        id: randomUUID(),
        resultId,
        beatmapId: map.beatmapId,
        mods: map.mods,
        passConditionType: map.passConditionType,
        passConditionThreshold: map.passConditionThreshold,
        ordinal: map.ordinal,
        score: map.score,
        accuracy: map.accuracy,
        maxCombo: map.maxCombo,
        count300: map.count300,
        count100: map.count100,
        count50: map.count50,
        countMiss: map.countMiss,
        passed: map.passed,
        createdAt: map.createdAt,
      })),
    ).run();
  });

  const storedMaps = await database
    .select()
    .from(mapResults)
    .where(eq(mapResults.resultId, resultId))
    .orderBy(asc(mapResults.ordinal));

  return {
    result,
    maps: storedMaps,
  };
}

function deriveRunStatus(
  passed: boolean,
  maps: Array<{ passed: boolean }>,
  beatmapCount: number,
): DerivedRunStatus {
  if (passed) {
    return "pass";
  }

  if (maps.length === beatmapCount) {
    return "fail";
  }

  if (maps.at(-1)?.passed === false) {
    return "fail";
  }

  return "dnf";
}
