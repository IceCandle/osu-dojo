import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDatabase, type AppDatabase } from "@/db/client";
import {
  beatmapMetadata,
  beatmaps,
  courseAliases,
  courses,
  danSystems,
  mapResults,
  runs,
} from "@/db/schema";
import type {
  CourseBeatmapDefinition,
  CourseDefinition,
  CourseRunResult,
  JudgedMapResult,
} from "@/lib/domain";
import { kebabizeName } from "@/lib/format";

type DerivedRunStatus = "pass" | "fail" | "dnf";

type CourseRow = {
  courseId: string;
  courseName: string;
  slug: string;
  courseDescription: string;
  tags: string;
  courseOrdinal: number;
  status: CourseDefinition["status"];
  scoreModel: CourseDefinition["scoreModel"] | null;
  overallPassType: CourseDefinition["overallPassType"];
  overallPassThreshold: number | null;
  danSystemId: string;
  danSystemName: string;
  danSystemSlug: string;
  danSystemDescription: string;
};

async function useDb(db?: AppDatabase): Promise<AppDatabase> {
  return db ?? getDatabase();
}

export async function listDanSystemsWithCourses(db?: AppDatabase) {
  const database = await useDb(db);
  const rows = await database
    .select({
      danSystemId: danSystems.id,
      danSystemName: danSystems.name,
      danSystemSlug: danSystems.slug,
      danSystemDescription: danSystems.description,
      courseId: courses.id,
      courseName: courses.name,
      slug: courses.slug,
      courseDescription: courses.description,
      tags: courses.tags,
      courseOrdinal: courses.ordinal,
      status: courses.status,
      scoreModel: courses.scoreModel,
      overallPassType: courses.overallPassType,
      overallPassThreshold: courses.overallPassThreshold,
    })
    .from(danSystems)
    .leftJoin(
      courses,
      and(eq(courses.danSystemId, danSystems.id), eq(courses.status, "published")),
    )
    .orderBy(asc(danSystems.name), asc(courses.ordinal));

  const systems = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      description: string;
      courses: Array<{
        id: string;
        name: string;
        slug: string;
        description: string;
        ordinal: number;
        scoreModel: CourseDefinition["scoreModel"];
        overallPassType: CourseDefinition["overallPassType"];
        overallPassThreshold: number | null;
      }>;
    }
  >();

  for (const row of rows) {
    const system =
      systems.get(row.danSystemId) ??
      {
        id: row.danSystemId,
        name: row.danSystemName,
        slug: row.danSystemSlug,
        description: row.danSystemDescription,
        courses: [],
      };

    if (row.courseId) {
      system.courses.push({
        id: row.courseId,
        name: row.courseName ?? "",
        slug: row.slug ?? "",
        description: row.courseDescription ?? "",
        ordinal: row.courseOrdinal ?? 0,
        scoreModel: row.scoreModel ?? "scorev2",
        overallPassType: row.overallPassType,
        overallPassThreshold: row.overallPassThreshold,
      });
    }

    systems.set(system.id, system);
  }

  return [...systems.values()];
}

export async function listCoursesByDanSystemNameKey(
  systemNameKey: string,
  db?: AppDatabase,
): Promise<CourseDefinition[]> {
  const database = await useDb(db);
  const rows = await database
    .select({
      courseId: courses.id,
      courseName: courses.name,
      slug: courses.slug,
      courseDescription: courses.description,
      tags: courses.tags,
      courseOrdinal: courses.ordinal,
      status: courses.status,
      scoreModel: courses.scoreModel,
      overallPassType: courses.overallPassType,
      overallPassThreshold: courses.overallPassThreshold,
      danSystemId: danSystems.id,
      danSystemName: danSystems.name,
      danSystemSlug: danSystems.slug,
      danSystemDescription: danSystems.description,
    })
    .from(courses)
    .innerJoin(danSystems, eq(courses.danSystemId, danSystems.id))
    .where(eq(courses.status, "published"))
    .orderBy(asc(danSystems.name), asc(courses.ordinal));

  const normalizedSystemNameKey = kebabizeName(systemNameKey);
  const matchingRows = rows.filter(
    (row) => kebabizeName(row.danSystemName) === normalizedSystemNameKey,
  );

  if (matchingRows.length === 0) {
    return [];
  }

  return hydrateCourseRows(matchingRows, database);
}

export async function getCourseByNameKey(
  systemNameKey: string,
  courseNameKey: string,
  db?: AppDatabase,
): Promise<CourseDefinition | null> {
  const database = await useDb(db);
  const courseDefinitions = await listCoursesByDanSystemNameKey(
    systemNameKey,
    database,
  );
  const normalizedCourseNameKey = kebabizeName(courseNameKey);

  return (
    courseDefinitions.find(
      (course) => kebabizeName(course.name) === normalizedCourseNameKey,
    ) ??
    (await getPublishedCourseByAlias(systemNameKey, normalizedCourseNameKey, database))
  );
}

export async function getDraftCourseByNameKey(
  systemNameKey: string,
  courseNameKey: string,
  db?: AppDatabase,
): Promise<CourseDefinition | null> {
  const database = await useDb(db);
  return getCourseByNameKeyAndStatus(systemNameKey, courseNameKey, "draft", database);
}

async function getCourseByNameKeyAndStatus(
  systemNameKey: string,
  courseNameKey: string,
  status: CourseDefinition["status"],
  database: AppDatabase,
): Promise<CourseDefinition | null> {
  const normalizedSystemNameKey = kebabizeName(systemNameKey);
  const normalizedCourseNameKey = kebabizeName(courseNameKey);
  const rows = await database
    .select({
      courseId: courses.id,
      courseName: courses.name,
      slug: courses.slug,
      courseDescription: courses.description,
      tags: courses.tags,
      courseOrdinal: courses.ordinal,
      status: courses.status,
      scoreModel: courses.scoreModel,
      overallPassType: courses.overallPassType,
      overallPassThreshold: courses.overallPassThreshold,
      danSystemId: danSystems.id,
      danSystemName: danSystems.name,
      danSystemSlug: danSystems.slug,
      danSystemDescription: danSystems.description,
    })
    .from(courses)
    .innerJoin(danSystems, eq(courses.danSystemId, danSystems.id))
    .where(eq(courses.status, status))
    .orderBy(asc(danSystems.name), asc(courses.ordinal));

  const matchingRows = rows.filter(
    (row) =>
      kebabizeName(row.danSystemName) === normalizedSystemNameKey &&
      kebabizeName(row.courseName) === normalizedCourseNameKey,
  );

  if (matchingRows.length === 0) {
    return null;
  }

  const [course] = await hydrateCourseRows(matchingRows, database);
  return course ?? null;
}

async function getPublishedCourseByAlias(
  systemNameKey: string,
  aliasKey: string,
  database: AppDatabase,
) {
  const normalizedSystemNameKey = kebabizeName(systemNameKey);
  const aliasRows = await database
    .select({
      courseId: courses.id,
      courseName: courses.name,
      slug: courses.slug,
      courseDescription: courses.description,
      tags: courses.tags,
      courseOrdinal: courses.ordinal,
      status: courses.status,
      scoreModel: courses.scoreModel,
      overallPassType: courses.overallPassType,
      overallPassThreshold: courses.overallPassThreshold,
      danSystemId: danSystems.id,
      danSystemName: danSystems.name,
      danSystemSlug: danSystems.slug,
      danSystemDescription: danSystems.description,
    })
    .from(courseAliases)
    .innerJoin(courses, eq(courseAliases.courseId, courses.id))
    .innerJoin(danSystems, eq(courseAliases.danSystemId, danSystems.id))
    .where(and(eq(courseAliases.aliasKey, aliasKey), eq(courses.status, "published")));

  const matchingRows = aliasRows.filter(
    (row) => kebabizeName(row.danSystemName) === normalizedSystemNameKey,
  );

  if (matchingRows.length === 0) {
    return null;
  }

  const [course] = await hydrateCourseRows(matchingRows, database);
  return course ?? null;
}

async function hydrateCourseRows(
  rows: CourseRow[],
  database: AppDatabase,
): Promise<CourseDefinition[]> {
  const beatmapRows = await database
    .select({
      courseId: beatmaps.courseId,
      id: beatmaps.id,
      beatmapId: beatmaps.beatmapId,
      mods: beatmaps.mods,
      passConditionType: beatmaps.passConditionType,
      passConditionThreshold: beatmaps.passConditionThreshold,
      ordinal: beatmaps.ordinal,
      annotations: beatmaps.annotations,
      title: beatmapMetadata.title,
      artist: beatmapMetadata.artist,
      difficultyName: beatmapMetadata.difficultyName,
      mapper: beatmapMetadata.mapper,
      coverUrl: beatmapMetadata.coverUrl,
      totalObjects: beatmapMetadata.totalObjects,
    })
    .from(beatmaps)
    .leftJoin(beatmapMetadata, eq(beatmaps.beatmapId, beatmapMetadata.beatmapId))
    .where(
      inArray(
        beatmaps.courseId,
        rows.map((row) => row.courseId),
      ),
    )
    .orderBy(asc(beatmaps.ordinal));

  const beatmapsByCourseId = new Map<string, typeof beatmapRows>();
  for (const row of beatmapRows) {
    const bucket = beatmapsByCourseId.get(row.courseId) ?? [];
    bucket.push(row);
    beatmapsByCourseId.set(row.courseId, bucket);
  }

  return rows.map((row) => ({
    id: row.courseId,
    danSystemId: row.danSystemId,
    danSystemName: row.danSystemName,
    danSystemSlug: row.danSystemSlug,
    danSystemDescription: row.danSystemDescription,
    name: row.courseName,
    slug: row.slug,
    description: row.courseDescription,
    tags: parseTags(row.tags),
    ordinal: row.courseOrdinal,
    status: row.status,
    scoreModel: row.scoreModel ?? "scorev2",
    overallPassType: row.overallPassType,
    overallPassThreshold: row.overallPassThreshold,
    beatmaps: (beatmapsByCourseId.get(row.courseId) ?? []).map(parseBeatmapRow),
  }));
}

export async function listCourseRunsByNameKey(
  systemNameKey: string,
  courseNameKey: string,
  db?: AppDatabase,
) {
  const database = await useDb(db);
  const course = await getCourseByNameKey(systemNameKey, courseNameKey, database);

  if (!course) {
    return null;
  }

  const runRows = await database
    .select({
      id: runs.id,
      userId: runs.userId,
      username: runs.username,
      passed: runs.passed,
      completedAt: runs.completedAt,
      matchId: runs.matchId,
    })
    .from(runs)
    .where(eq(runs.courseId, course.id))
    .orderBy(desc(runs.completedAt))
    .limit(20);

  if (runRows.length === 0) {
    return { course, runs: [] };
  }

  const mapsByRunId = await getMapsByRunId(runRows.map((row) => row.id), database);

  return {
    course,
    runs: runRows.map((row) => {
      const maps = mapsByRunId.get(row.id) ?? [];
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
  const course = await getCourseByNameKey(systemNameKey, courseNameKey, database);

  if (!course) {
    return null;
  }

  return getRankingForCourse(course, database);
}

export async function getRankingForCourse(
  course: CourseDefinition,
  db?: AppDatabase,
) {
  const database = await useDb(db);

  const runRows = await database
    .select({
      id: runs.id,
      userId: runs.userId,
      username: runs.username,
      passed: runs.passed,
      completedAt: runs.completedAt,
      matchId: runs.matchId,
    })
    .from(runs)
    .where(eq(runs.courseId, course.id));

  if (runRows.length === 0) {
    return { course, results: [] };
  }

  const mapsByRunId = await getMapsByRunId(runRows.map((row) => row.id), database);

  const allSortedResults = runRows
    .map((row) => {
      const maps = mapsByRunId.get(row.id) ?? [];
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

export async function storeCourseRunResult(
  input: {
    userId: number;
    username: string;
    courseId: string;
    passed: boolean;
    startedAt: number;
    completedAt: number;
    matchId?: number | null;
    maps: Omit<JudgedMapResult, "id" | "runId">[];
  },
  db?: AppDatabase,
): Promise<{ run: CourseRunResult; maps: JudgedMapResult[] }> {
  const database = await useDb(db);
  const runId = randomUUID();
  const run = {
    id: runId,
    userId: input.userId,
    username: input.username,
    courseId: input.courseId,
    passed: input.passed,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    matchId: input.matchId ?? null,
  } satisfies CourseRunResult;

  database.transaction((tx) => {
    tx.insert(runs).values(run).run();
    tx.insert(mapResults).values(
      input.maps.map((map) => ({
        id: randomUUID(),
        runId,
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
    .where(eq(mapResults.runId, runId))
    .orderBy(asc(mapResults.ordinal));

  return {
    run,
    maps: storedMaps,
  };
}

async function getMapsByRunId(runIds: string[], database: AppDatabase) {
  const mapRows = await database
    .select()
    .from(mapResults)
    .where(inArray(mapResults.runId, runIds))
    .orderBy(asc(mapResults.ordinal), asc(mapResults.createdAt));

  const mapsByRunId = new Map<string, typeof mapRows>();
  for (const row of mapRows) {
    const bucket = mapsByRunId.get(row.runId) ?? [];
    bucket.push(row);
    mapsByRunId.set(row.runId, bucket);
  }

  return mapsByRunId;
}

function parseBeatmapRow(row: {
  id: string;
  beatmapId: number;
  mods: string;
  passConditionType: CourseBeatmapDefinition["passConditionType"];
  passConditionThreshold: number;
  ordinal: number;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  mapper: string | null;
  coverUrl: string | null;
  totalObjects: unknown;
  annotations: string;
}): CourseBeatmapDefinition {
  return {
    id: row.id,
    beatmapId: row.beatmapId,
    mods: row.mods,
    passConditionType: row.passConditionType,
    passConditionThreshold: row.passConditionThreshold,
    ordinal: row.ordinal,
    title: row.title ?? "",
    artist: row.artist ?? "",
    difficultyName: row.difficultyName ?? "",
    mapper: row.mapper ?? "",
    coverUrl: row.coverUrl ?? "",
    totalObjects: normalizeTotalObjects(row.totalObjects),
    annotations: parseAnnotations(row.annotations),
  };
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function normalizeTotalObjects(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
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
  // This uses the live course beatmap count only because published course gameplay is
  // immutable; draft runs are never persisted.
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
  scoreModel: CourseDefinition["scoreModel"],
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

  return (
    compareNumbersDesc(left.completedAt, right.completedAt) ||
    left.id.localeCompare(right.id)
  );
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
