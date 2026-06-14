import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir, type DanSystemSeed } from "@/db/courseLoader";
import {
  getCourseByNameKey,
  getRankingByNameKey,
  storeCourseRunResult,
} from "@/db/queries";
import { clearAllData, cloneCourseSystems, seedDatabase } from "@/db/seed";
import DanCoursePage from "@/app/dan/[systemNameKey]/page";
import type { CourseDefinition, JudgedMapResult } from "@/lib/domain";
import { createTempDatabaseUrl as createTempDatabaseUrlWithPrefix } from "./helpers/tempDatabase";

const SEEDED_SYSTEM_NAME_KEY = "test";
const SEEDED_COURSE_SLUG = "test-1dan";

const createTempDatabaseUrl = () => createTempDatabaseUrlWithPrefix("osudojo-web-");

async function seedRankingCourses(databaseUrl: string) {
  const databaseBundle = await createTestDatabase(databaseUrl);
  const { db } = databaseBundle;
  const systems = cloneCourseSystems(
    loadCoursesFromDir(path.join(process.cwd(), "data/courses")),
  );
  const system = systems.find((s) => s.slug === SEEDED_SYSTEM_NAME_KEY);
  const baseCourse = system?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

  assert.ok(system);
  assert.ok(baseCourse);

  system.courses.push(
    cloneCourse(baseCourse, {
      id: "course-ranking-acc",
      name: "Ranking Acc",
      slug: "ranking-acc",
      description: "Accuracy-ranked test course for the integrated leaderboard.",
      scoreModel: "scorev1",
      overallPassConditions: [{ type: "courseAccuracy", threshold: 95 }],
    }),
    cloneCourse(baseCourse, {
      id: "course-ranking-sv2",
      name: "Ranking Sv2",
      slug: "ranking-sv2",
      description: "Score-ranked test course for the integrated leaderboard.",
      scoreModel: "scorev2",
      overallPassConditions: [{ type: "totalScore", threshold: 1_800_000 }],
      beatmaps: createRankingSv2Beatmaps(baseCourse),
    }),
    cloneCourse(baseCourse, {
      id: "course-ranking-empty",
      name: "Ranking Empty",
      slug: "ranking-empty",
      description: "Empty test course for the integrated leaderboard.",
      scoreModel: "scorev2",
      overallPassConditions: [{ type: "courseAccuracy", threshold: 90 }],
    }),
  );

  await clearAllData(db);
  await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

  const accCourse = await getCourseByNameKey(
    SEEDED_SYSTEM_NAME_KEY,
    "ranking-acc",
    db,
  );
  const sv2Course = await getCourseByNameKey(
    SEEDED_SYSTEM_NAME_KEY,
    "ranking-sv2",
    db,
  );
  const emptyCourse = await getCourseByNameKey(
    SEEDED_SYSTEM_NAME_KEY,
    "ranking-empty",
    db,
  );

  assert.ok(accCourse);
  assert.ok(sv2Course);
  assert.ok(emptyCourse);

  return { db, databaseBundle, accCourse, sv2Course, emptyCourse };
}

function cloneCourse(
  course: DanSystemSeed["courses"][number],
  overrides: Pick<
    DanSystemSeed["courses"][number],
    | "id"
    | "name"
    | "slug"
    | "description"
    | "scoreModel"
    | "overallPassConditions"
  > &
    Partial<Pick<DanSystemSeed["courses"][number], "beatmaps">>,
): DanSystemSeed["courses"][number] {
  return {
    ...course,
    ...overrides,
    beatmaps: (overrides.beatmaps ?? course.beatmaps).map((beatmap) => ({
      ...beatmap,
      id: `${overrides.id}-beatmap-${beatmap.ordinal}`,
    })),
  };
}

function createRankingSv2Beatmaps(
  baseCourse: DanSystemSeed["courses"][number],
): DanSystemSeed["courses"][number]["beatmaps"] {
  const [freemodBeatmap, fixedModBeatmap] = baseCourse.beatmaps;

  assert.ok(freemodBeatmap);
  assert.ok(fixedModBeatmap);

  return [
    {
      ...freemodBeatmap,
      mods: "",
      freemod: true,
      ordinal: 1,
    },
    {
      ...fixedModBeatmap,
      mods: "DT",
      freemod: false,
      ordinal: 2,
    },
  ];
}

async function storeCourseRun(
  course: CourseDefinition,
  input: {
    userId: number;
    username: string;
    passed: boolean;
    completedAt: number;
    matchId?: number | null;
    maps: Array<{
      gameId?: number;
      score: number;
      rawScore?: number;
      playedMods?: string;
      accuracy: number;
      maxCombo: number;
      count300: number;
      count100: number;
      count50: number;
      countMiss: number;
      passed: boolean;
    }>;
  },
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
) {
  const maps = course.beatmaps
    .slice(0, input.maps.length)
    .map((beatmap, index) => buildMapResult(beatmap, input.maps[index]!, input.completedAt));

  return storeCourseRunResult(
    {
      userId: input.userId,
      username: input.username,
      courseId: course.id,
      passed: input.passed,
      startedAt: input.completedAt - 120_000,
      completedAt: input.completedAt,
      matchId: input.matchId ?? null,
      maps,
    },
    db,
  );
}

function buildMapResult(
  beatmap: CourseDefinition["beatmaps"][number],
  stats: {
    gameId?: number;
    score: number;
    rawScore?: number;
    playedMods?: string;
    accuracy: number;
    maxCombo: number;
    count300: number;
    count100: number;
    count50: number;
    countMiss: number;
    passed: boolean;
  },
  completedAt: number,
): Omit<JudgedMapResult, "id" | "runId"> {
  return {
    gameId: stats.gameId ?? beatmap.ordinal,
    beatmapId: beatmap.beatmapId,
    mods: beatmap.mods,
    passConditions: beatmap.passConditions,
    ordinal: beatmap.ordinal,
    score: stats.score,
    rawScore: stats.rawScore ?? stats.score,
    playedMods: stats.playedMods ?? beatmap.mods,
    accuracy: stats.accuracy,
    maxCombo: stats.maxCombo,
    count300: stats.count300,
    count100: stats.count100,
    count50: stats.count50,
    countMiss: stats.countMiss,
    passed: stats.passed,
    createdAt: completedAt - beatmap.ordinal * 1_000,
  };
}

test("getRankingByNameKey sorts scorev1 courses by status then summed passed-map accuracy", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db, accCourse } = await seedRankingCourses(temp.url);

    await storeCourseRun(
      accCourse,
      {
        userId: 1,
        username: "Alpha",
        passed: true,
        completedAt: 1_800_000_100_000,
        maps: [
          {
            score: 940_000,
            accuracy: 99,
            maxCombo: 950,
            count300: 1_100,
            count100: 20,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 910_000,
            accuracy: 98,
            maxCombo: 910,
            count300: 1_050,
            count100: 30,
            count50: 2,
            countMiss: 1,
            passed: true,
          },
        ],
      },
      db,
    );

    await storeCourseRun(
      accCourse,
      {
        userId: 2,
        username: "Beta",
        passed: true,
        completedAt: 1_800_000_200_000,
        maps: [
          {
            score: 980_000,
            accuracy: 98,
            maxCombo: 900,
            count300: 1_080,
            count100: 24,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 970_000,
            accuracy: 97,
            maxCombo: 870,
            count300: 1_020,
            count100: 36,
            count50: 3,
            countMiss: 1,
            passed: true,
          },
        ],
      },
      db,
    );

    await storeCourseRun(
      accCourse,
      {
        userId: 3,
        username: "Gamma",
        passed: false,
        completedAt: 1_800_000_300_000,
        maps: [
          {
            score: 990_000,
            accuracy: 99.5,
            maxCombo: 920,
            count300: 1_120,
            count100: 15,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 980_000,
            accuracy: 98.5,
            maxCombo: 880,
            count300: 1_090,
            count100: 18,
            count50: 2,
            countMiss: 2,
            passed: false,
          },
        ],
      },
      db,
    );

    await storeCourseRun(
      accCourse,
      {
        userId: 4,
        username: "Delta",
        passed: false,
        completedAt: 1_800_000_400_000,
        maps: [
          {
            score: 995_000,
            accuracy: 100,
            maxCombo: 930,
            count300: 1_130,
            count100: 10,
            count50: 0,
            countMiss: 0,
            passed: true,
          },
        ],
      },
      db,
    );

    const ranking = await getRankingByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      "ranking-acc",
      db,
    );

    assert.ok(ranking);
    assert.deepEqual(
      ranking.results.map((result) => result.username),
      ["Alpha", "Beta", "Gamma", "Delta"],
    );
    assert.equal(ranking.results[0]?.summedAccuracy, 197);
    assert.equal(ranking.results[1]?.summedAccuracy, 195);
    assert.equal(ranking.results[2]?.status, "fail");
    assert.equal(ranking.results[2]?.summedAccuracy, 99.5);
    assert.equal(ranking.results[3]?.status, "dnf");
    assert.equal(ranking.results[3]?.summedAccuracy, 100);
  } finally {
    temp.cleanup();
  }
});

test("getRankingByNameKey sorts scorev2 courses by status then total score", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db, sv2Course } = await seedRankingCourses(temp.url);

    await storeCourseRun(
      sv2Course,
      {
        userId: 11,
        username: "ScoreLead",
        passed: true,
        completedAt: 1_800_001_000_000,
        maps: [
          {
            score: 1_300_000,
            rawScore: 1_300_000,
            playedMods: "",
            accuracy: 97,
            maxCombo: 900,
            count300: 1_040,
            count100: 22,
            count50: 2,
            countMiss: 0,
            passed: true,
          },
          {
            score: 600_000,
            rawScore: 600_000,
            playedMods: "",
            accuracy: 96,
            maxCombo: 880,
            count300: 1_010,
            count100: 30,
            count50: 3,
            countMiss: 1,
            passed: true,
          },
        ],
      },
      db,
    );

    await storeCourseRun(
      sv2Course,
      {
        userId: 12,
        username: "FailedButHuge",
        passed: false,
        completedAt: 1_800_001_100_000,
        maps: [
          {
            score: 999_000,
            accuracy: 99,
            maxCombo: 910,
            count300: 1_100,
            count100: 16,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 998_000,
            accuracy: 98,
            maxCombo: 900,
            count300: 1_090,
            count100: 18,
            count50: 2,
            countMiss: 1,
            passed: false,
          },
        ],
      },
      db,
    );

    await storeCourseRun(
      sv2Course,
      {
        userId: 13,
        username: "ScoreTwo",
        passed: true,
        completedAt: 1_800_001_200_000,
        maps: [
          {
            score: 1_200_686,
            rawScore: 1_400_000,
            playedMods: "HDHR",
            accuracy: 98,
            maxCombo: 890,
            count300: 1_050,
            count100: 18,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 600_000,
            rawScore: 600_000,
            playedMods: "",
            accuracy: 97,
            maxCombo: 860,
            count300: 1_000,
            count100: 24,
            count50: 2,
            countMiss: 1,
            passed: true,
          },
        ],
      },
      db,
    );

    const ranking = await getRankingByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      "ranking-sv2",
      db,
    );

    assert.ok(ranking);
    assert.deepEqual(
      ranking.results.map((result) => result.username),
      ["ScoreLead", "ScoreTwo", "FailedButHuge"],
    );
    assert.equal(ranking.results[0]?.totalScore, 1_900_000);
    assert.equal(ranking.results[1]?.totalScore, 1_800_686);
    assert.equal(ranking.results[2]?.status, "fail");
    assert.equal(ranking.results[2]?.totalScore, 1_997_000);
  } finally {
    temp.cleanup();
  }
});

test("getRankingByNameKey keeps only each player's best run", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db, accCourse } = await seedRankingCourses(temp.url);

    await storeCourseRun(
      accCourse,
      {
        userId: 31,
        username: "RepeatPlayer",
        passed: true,
        completedAt: 1_800_001_400_000,
        maps: [
          {
            score: 940_000,
            accuracy: 99,
            maxCombo: 930,
            count300: 1_090,
            count100: 18,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 930_000,
            accuracy: 98,
            maxCombo: 920,
            count300: 1_070,
            count100: 22,
            count50: 2,
            countMiss: 1,
            passed: true,
          },
        ],
      },
      db,
    );

    await storeCourseRun(
      accCourse,
      {
        userId: 31,
        username: "RepeatPlayer",
        passed: false,
        completedAt: 1_800_001_500_000,
        maps: [
          {
            score: 900_000,
            accuracy: 95,
            maxCombo: 870,
            count300: 1_010,
            count100: 40,
            count50: 5,
            countMiss: 4,
            passed: true,
          },
          {
            score: 880_000,
            accuracy: 94,
            maxCombo: 840,
            count300: 980,
            count100: 46,
            count50: 6,
            countMiss: 5,
            passed: false,
          },
        ],
      },
      db,
    );

    await storeCourseRun(
      accCourse,
      {
        userId: 32,
        username: "SingleRun",
        passed: true,
        completedAt: 1_800_001_600_000,
        maps: [
          {
            score: 920_000,
            accuracy: 97,
            maxCombo: 900,
            count300: 1_060,
            count100: 26,
            count50: 2,
            countMiss: 1,
            passed: true,
          },
          {
            score: 910_000,
            accuracy: 96,
            maxCombo: 890,
            count300: 1_040,
            count100: 30,
            count50: 3,
            countMiss: 2,
            passed: true,
          },
        ],
      },
      db,
    );

    const ranking = await getRankingByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      "ranking-acc",
      db,
    );

    assert.ok(ranking);
    assert.equal(ranking.results.length, 2);
    assert.deepEqual(
      ranking.results.map((result) => result.username),
      ["RepeatPlayer", "SingleRun"],
    );
    assert.equal(ranking.results[0]?.summedAccuracy, 197);
  } finally {
    temp.cleanup();
  }
});

test("DanCoursePage renders the integrated leaderboard and empty state on the system page", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    const { db, databaseBundle, accCourse, sv2Course } = await seedRankingCourses(
      temp.url,
    );

    await storeCourseRun(
      accCourse,
      {
        userId: 21,
        username: "RenderPlayer",
        passed: true,
        completedAt: 1_800_002_000_000,
        matchId: 4242,
        maps: [
          {
            score: 940_000,
            accuracy: 99,
            maxCombo: 950,
            count300: 1_100,
            count100: 20,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 910_000,
            accuracy: 98,
            maxCombo: 910,
            count300: 1_050,
            count100: 30,
            count50: 2,
            countMiss: 1,
            passed: true,
          },
        ],
      },
      db,
    );
    await storeCourseRun(
      sv2Course,
      {
        userId: 22,
        username: "ScoreRenderPlayer",
        passed: true,
        completedAt: 1_800_002_100_000,
        maps: [
          {
            score: 1_200_000,
            rawScore: 1_200_000,
            accuracy: 98,
            maxCombo: 900,
            count300: 1_080,
            count100: 20,
            count50: 1,
            countMiss: 0,
            passed: true,
          },
          {
            score: 650_000,
            rawScore: 650_000,
            accuracy: 97,
            maxCombo: 870,
            count300: 1_020,
            count100: 30,
            count50: 2,
            countMiss: 1,
            passed: true,
          },
        ],
      },
      db,
    );

    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = databaseBundle;

    const courseHtml = renderToStaticMarkup(
      await DanCoursePage({
        params: Promise.resolve({
          systemNameKey: SEEDED_SYSTEM_NAME_KEY,
        }),
        searchParams: Promise.resolve({
          course: "ranking-acc",
        }),
      }),
    );
    const sv2Html = renderToStaticMarkup(
      await DanCoursePage({
        params: Promise.resolve({
          systemNameKey: SEEDED_SYSTEM_NAME_KEY,
        }),
        searchParams: Promise.resolve({
          course: "ranking-sv2",
        }),
      }),
    );
    const emptyHtml = renderToStaticMarkup(
      await DanCoursePage({
        params: Promise.resolve({
          systemNameKey: SEEDED_SYSTEM_NAME_KEY,
        }),
        searchParams: Promise.resolve({
          course: "ranking-empty",
        }),
      }),
    );

    assert.match(courseHtml, /Course sequence/);
    assert.match(courseHtml, /Top runs/);
    assert.match(courseHtml, /RenderPlayer/);
    assert.match(
      courseHtml,
      /<a class="ranking-player-link" href="\/players\/21"><strong class="ranking-player-name">RenderPlayer<\/strong><\/a>/,
    );
    assert.match(courseHtml, /Course Acc/);
    assert.match(courseHtml, /status-pass/);
    assert.match(courseHtml, /https:\/\/osu\.ppy\.sh\/mp\/4242/);
    assert.doesNotMatch(courseHtml, /Stage 1/);
    assert.doesNotMatch(courseHtml, /Beatmap 1/);
    assert.doesNotMatch(courseHtml, /\b\d{1,2}:\d{2}\b/);
    assert.match(sv2Html, /Adjusted Score Total/);
    assert.match(sv2Html, /class="mod-label">\+/);
    assert.match(sv2Html, /class="mod-token mod-token-fm">FM<\/span>/);
    assert.match(sv2Html, /class="mod-token mod-token-dt">DT<\/span>/);
    assert.doesNotMatch(sv2Html, /\+NF/);
    assert.match(emptyHtml, /No runs saved yet/);
    assert.match(emptyHtml, /!dojo start test ranking-empty/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("DanCoursePage renders an empty state for systems with no courses", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    const databaseBundle = await createTestDatabase(temp.url);
    const { db } = databaseBundle;
    const systems = cloneCourseSystems(
      loadCoursesFromDir(path.join(process.cwd(), "data/courses")),
    );

    systems.push({
      id: "system-empty",
      name: "empty",
      slug: "empty",
      description: "A system shell with no courses yet.",
      status: "current",
      courses: [],
    });

    await clearAllData(db);
    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = databaseBundle;

    const html = renderToStaticMarkup(
      await DanCoursePage({
        params: Promise.resolve({
          systemNameKey: "empty",
        }),
      }),
    );

    assert.match(html, /empty/);
    assert.match(html, /No courses available/);
    assert.match(html, /does not have any playable courses yet/);
    assert.doesNotMatch(html, /Course sequence/);
    assert.doesNotMatch(html, /Top runs/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});
