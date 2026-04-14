import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDatabase, type AppDatabase } from "@/db/client";
import { danBeatmaps, dans, danSystems, mapResults, results } from "@/db/schema";
import type {
  DanBeatmapDefinition,
  DanCourseDefinition,
  JudgedMapResult,
  StoredRunResult,
} from "@/lib/domain";
import { kebabizeName } from "@/lib/format";

type DerivedRunStatus = "pass" | "fail" | "dnf";

type DanCourseRow = {
  danId: string;
  danName: string;
  courseSlug: string;
  danDescription: string;
  danOrdinal: number;
  scoreModel: DanCourseDefinition["scoreModel"] | null;
  overallPassType: DanCourseDefinition["overallPassType"];
  overallPassThreshold: number | null;
  systemId: string;
  systemName: string;
  systemSlug: string;
  systemDescription: string;
};

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
      courseSlug: dans.courseSlug,
      danDescription: dans.description,
      danOrdinal: dans.ordinal,
      scoreModel: dans.scoreModel,
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
        courseSlug: string;
        description: string;
        ordinal: number;
        scoreModel: DanCourseDefinition["scoreModel"];
        overallPassType: DanCourseDefinition["overallPassType"];
        overallPassThreshold: number | null;
      }>;
    }
  >();

  for (const row of rows) {
    const system =
      systems.get(row.systemId) ??
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
        courseSlug: row.courseSlug ?? "",
        description: row.danDescription ?? "",
        ordinal: row.danOrdinal ?? 0,
        scoreModel: row.scoreModel ?? "scorev2",
        overallPassType: row.overallPassType,
        overallPassThreshold: row.overallPassThreshold,
      });
    }

    systems.set(system.id, system);
  }

  return [...systems.values()];
}

export async function listDanCoursesBySystemNameKey(
  systemNameKey: string,
  db?: AppDatabase,
): Promise<DanCourseDefinition[]> {
  const database = await useDb(db);
  const rows = await database
    .select({
      danId: dans.id,
      danName: dans.name,
      courseSlug: dans.courseSlug,
      danDescription: dans.description,
      danOrdinal: dans.ordinal,
      scoreModel: dans.scoreModel,
      overallPassType: dans.overallPassType,
      overallPassThreshold: dans.overallPassThreshold,
      systemId: danSystems.id,
      systemName: danSystems.name,
      systemSlug: danSystems.slug,
      systemDescription: danSystems.description,
    })
    .from(dans)
    .innerJoin(danSystems, eq(dans.danSystemId, danSystems.id))
    .orderBy(asc(danSystems.name), asc(dans.ordinal));

  const normalizedSystemNameKey = kebabizeName(systemNameKey);
  const matchingRows = rows.filter(
    (row) => kebabizeName(row.systemName) === normalizedSystemNameKey,
  );

  if (matchingRows.length === 0) {
    return [];
  }

  return hydrateCourseRows(matchingRows, database);
}

export async function getDanCourseByNameKey(
  systemNameKey: string,
  courseNameKey: string,
  db?: AppDatabase,
): Promise<DanCourseDefinition | null> {
  const database = await useDb(db);
  const courses = await listDanCoursesBySystemNameKey(systemNameKey, database);
  const normalizedCourseNameKey = kebabizeName(courseNameKey);

  return (
    courses.find((course) => kebabizeName(course.name) === normalizedCourseNameKey) ??
    null
  );
}

async function hydrateCourseRows(
  rows: DanCourseRow[],
  database: AppDatabase,
): Promise<DanCourseDefinition[]> {
  const beatmapRows = await database
    .select({
      danId: danBeatmaps.danId,
      id: danBeatmaps.id,
      beatmapId: danBeatmaps.beatmapId,
      mods: danBeatmaps.mods,
      passConditionType: danBeatmaps.passConditionType,
      passConditionThreshold: danBeatmaps.passConditionThreshold,
      ordinal: danBeatmaps.ordinal,
      title: danBeatmaps.title,
      artist: danBeatmaps.artist,
      difficultyName: danBeatmaps.difficultyName,
      mapper: danBeatmaps.mapper,
      coverUrl: danBeatmaps.coverUrl,
      annotations: danBeatmaps.annotations,
    })
    .from(danBeatmaps)
    .where(
      inArray(
        danBeatmaps.danId,
        rows.map((row) => row.danId),
      ),
    )
    .orderBy(asc(danBeatmaps.ordinal));

  const beatmapsByDanId = new Map<string, typeof beatmapRows>();
  for (const row of beatmapRows) {
    const bucket = beatmapsByDanId.get(row.danId) ?? [];
    bucket.push(row);
    beatmapsByDanId.set(row.danId, bucket);
  }

  return rows.map((row) => ({
    id: row.danId,
    danSystemId: row.systemId,
    danSystemName: row.systemName,
    danSystemSlug: row.systemSlug,
    danSystemDescription: row.systemDescription,
    name: row.danName,
    courseSlug: row.courseSlug,
    description: row.danDescription,
    ordinal: row.danOrdinal,
    scoreModel: row.scoreModel ?? "scorev2",
    overallPassType: row.overallPassType,
    overallPassThreshold: row.overallPassThreshold,
    beatmaps: (beatmapsByDanId.get(row.danId) ?? []).map(parseBeatmapRow),
  }));
}

export async function listDanResultsByNameKey(
  systemNameKey: string,
  courseNameKey: string,
  db?: AppDatabase,
) {
  const database = await useDb(db);
  const course = await getDanCourseByNameKey(
    systemNameKey,
    courseNameKey,
    database,
  );

  if (!course) {
    return null;
  }

  const resultRows = await database
    .select({
      id: results.id,
      userId: results.userId,
      username: results.username,
      passed: results.passed,
      completedAt: results.completedAt,
      matchId: results.matchId,
    })
    .from(results)
    .where(eq(results.danId, course.id))
    .orderBy(desc(results.completedAt))
    .limit(20);

  if (resultRows.length === 0) {
    return { course, results: [] };
  }

  const mapsByResultId = await getMapsByResultId(resultRows.map((row) => row.id), database);

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

export async function getRankingByNameKey(
  systemNameKey: string,
  courseNameKey: string,
  db?: AppDatabase,
) {
  const database = await useDb(db);
  const course = await getDanCourseByNameKey(systemNameKey, courseNameKey, database);

  if (!course) {
    return null;
  }

  return getRankingForCourse(course, database);
}

export async function getRankingForCourse(
  course: DanCourseDefinition,
  db?: AppDatabase,
) {
  const database = await useDb(db);

  const resultRows = await database
    .select({
      id: results.id,
      userId: results.userId,
      username: results.username,
      passed: results.passed,
      completedAt: results.completedAt,
      matchId: results.matchId,
    })
    .from(results)
    .where(eq(results.danId, course.id));

  if (resultRows.length === 0) {
    return { course, results: [] };
  }

  const mapsByResultId = await getMapsByResultId(resultRows.map((row) => row.id), database);

  const allSortedResults = resultRows
    .map((row) => {
      const maps = mapsByResultId.get(row.id) ?? [];
      const status = deriveRunStatus(row.passed, maps, course.beatmaps.length);

      return {
        id: row.id,
        username: row.username,
        userId: row.userId,
        completedAt: row.completedAt,
        matchId: row.matchId,
        status,
        totalScore: sum(maps.map((map) => map.score)),
        summedAccuracy:
          status === "pass"
            ? sum(maps.map((map) => map.accuracy))
            : sum(maps.filter((map) => map.passed).map((map) => map.accuracy)),
        maps,
      };
    })
    .sort((left, right) => compareRankingRows(left, right, course.scoreModel));

  const seenUserIds = new Set<number>();
  return {
    course,
    results: allSortedResults
      .filter((row) => {
        if (seenUserIds.has(row.userId)) {
          return false;
        }

        seenUserIds.add(row.userId);
        return true;
      })
      .map((row, index) => ({
        ...row,
        rank: index + 1,
      })),
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
    matchId?: number | null;
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
    matchId: input.matchId ?? null,
  } satisfies StoredRunResult;

  database.transaction((tx) => {
    tx.insert(results).values(result).run();
    tx.insert(mapResults).values(
      input.maps.map((map) => ({
        id: randomUUID(),
        resultId,
        gameId: map.gameId,
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

async function getMapsByResultId(resultIds: string[], database: AppDatabase) {
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

  return mapsByResultId;
}

function parseBeatmapRow(row: {
  id: string;
  beatmapId: number;
  mods: string;
  passConditionType: DanBeatmapDefinition["passConditionType"];
  passConditionThreshold: number;
  ordinal: number;
  title: string;
  artist: string;
  difficultyName: string;
  mapper: string;
  coverUrl: string;
  annotations: string;
}): DanBeatmapDefinition {
  return {
    id: row.id,
    beatmapId: row.beatmapId,
    mods: row.mods,
    passConditionType: row.passConditionType,
    passConditionThreshold: row.passConditionThreshold,
    ordinal: row.ordinal,
    title: row.title,
    artist: row.artist,
    difficultyName: row.difficultyName,
    mapper: row.mapper,
    coverUrl: row.coverUrl,
    annotations: parseAnnotations(row.annotations),
  };
}

function parseAnnotations(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
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

function compareRankingRows(
  left: {
    id: string;
    status: DerivedRunStatus;
    summedAccuracy: number;
    totalScore: number;
    completedAt: number;
  },
  right: {
    id: string;
    status: DerivedRunStatus;
    summedAccuracy: number;
    totalScore: number;
    completedAt: number;
  },
  scoreModel: DanCourseDefinition["scoreModel"],
): number {
  const statusComparison = getStatusWeight(left.status) - getStatusWeight(right.status);
  if (statusComparison !== 0) {
    return statusComparison;
  }

  const metricComparison =
    scoreModel === "scorev1"
      ? compareNumbersDesc(left.summedAccuracy, right.summedAccuracy)
      : compareNumbersDesc(left.totalScore, right.totalScore);

  if (metricComparison !== 0) {
    return metricComparison;
  }

  return compareNumbersDesc(left.completedAt, right.completedAt) || left.id.localeCompare(right.id);
}

function getStatusWeight(status: DerivedRunStatus): number {
  if (status === "pass") {
    return 0;
  }

  if (status === "fail") {
    return 1;
  }

  return 2;
}

function compareNumbersDesc(left: number, right: number): number {
  return right - left;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
