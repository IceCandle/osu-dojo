import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import "./helpers/nextTestEnvironment";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import { formatConditionCompact, formatScoreModel } from "@/lib/format";
import {
  getCourseByNameKey,
  listCourseRunsByNameKey,
  storeCourseRunResult,
} from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import DanSystemsPage from "@/app/dan/page";
import HomePage from "@/app/page";
import DanCoursePage from "@/app/dan/[systemNameKey]/page";
import {
  addSampleBeatmapMetadata,
  createTempDatabaseUrl,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";
import { withAnonymousRequestScope } from "./helpers/requestScope";
import { passRun } from "./helpers/runFixtures";

test("pages render seeded course data from SQLite", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    const databaseBundle = await createTestDatabase(temp.url);
    await seedDatabase(
      databaseBundle.db,
      addSampleBeatmapMetadata(
        cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
      ),
      { suppressMissingObjectCountWarnings: true },
    );
    globalThis.__osuDojoDatabaseBundle = databaseBundle;

    const homeHtml = renderToStaticMarkup(await HomePage());
    const systemsHtml = renderToStaticMarkup(await DanSystemsPage());
    const courseHtml = renderToStaticMarkup(
      await withAnonymousRequestScope(() => DanCoursePage({
        params: Promise.resolve({
          systemNameKey: SEEDED_SYSTEM_NAME_KEY,
        }),
        searchParams: Promise.resolve({
          course: SEEDED_COURSE_NAME_KEY,
        }),
      })),
    );
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
    );

    assert.ok(course);

    assert.match(homeHtml, /View dan systems/);
    assert.match(homeHtml, /Recent notable passes/);
    assert.match(homeHtml, /osu!standard/);
    assert.match(homeHtml, /No recent passes yet\./);
    assert.doesNotMatch(homeHtml, /Open system/);
    assert.match(systemsHtml, /test/i);
    assert.match(systemsHtml, /\/dan\/test/);
    assert.match(
      systemsHtml,
      /Choose a system to view its courses, pass rules, and saved top runs\./,
    );
    assert.match(courseHtml, /test stage one/i);
    assert.match(courseHtml, /!dojo start test 1st/);
    assert.match(courseHtml, /Sample dan system for the MVP\./);
    assert.match(courseHtml, new RegExp(course?.beatmaps[0]?.difficultyName ?? ""));
    assert.match(courseHtml, new RegExp(formatScoreModel(course.scoreModel)));
    if (course.overallPassConditions.length > 0) {
      assert.match(
        courseHtml,
        new RegExp(
          escapeRegExp(
            escapeRenderedText(
              course.overallPassConditions.map(formatConditionCompact).join(" / "),
            ),
          ),
        ),
      );
    }
    for (const beatmap of course.beatmaps) {
      assert.match(
        courseHtml,
        new RegExp(
          escapeRegExp(
            escapeRenderedText(
              beatmap.passConditions.map(formatConditionCompact).join(" / "),
            ),
          ),
        ),
      );
    }
    assert.match(courseHtml, /No runs saved yet/);
    assert.doesNotMatch(courseHtml, /\b\d{1,2}:\d{2}\b/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("home page renders a featured official notable pass", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    const databaseBundle = await createTestDatabase(temp.url);
    globalThis.__osuDojoDatabaseBundle = databaseBundle;
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      databaseBundle.db,
    );
    assert.ok(course);

    databaseBundle.sqlite
      .prepare(
        `INSERT INTO homepage_featured_courses (course_id, position)
         VALUES (?, ?)`,
      )
      .run(course.id, 1);
    await storeCourseRunResult(
      passRun(450, "NotablePlayer", course, Date.now() - 60_000),
      databaseBundle.db,
    );

    const homeHtml = renderToStaticMarkup(await HomePage());

    assert.match(homeHtml, /NotablePlayer/);
    assert.match(homeHtml, /href="\/players\/450"/);
    assert.match(homeHtml, new RegExp(course.label ?? course.name));
    assert.match(homeHtml, /osu!standard/);
    assert.doesNotMatch(homeHtml, /No recent passes yet\./);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("catalog hides drafts but exact-key draft detail renders", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    const databaseBundle = await createTestDatabase(temp.url);
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const baseSystem = systems[0]!;
    const copySystem = (
      id: string,
      name: string,
      status: "draft" | "archived",
    ) => ({
      ...baseSystem,
      id,
      name,
      slug: name,
      description: `${name} system`,
      status,
      courses: baseSystem.courses.map((course) => ({
        ...course,
        id: `${id}-${course.id}`,
        slug: `${name}-${course.slug}`,
        beatmaps: course.beatmaps.map((beatmap) => ({
          ...beatmap,
          id: `${id}-${beatmap.id}`,
        })),
      })),
    });

    await seedDatabase(
      databaseBundle.db,
      [
        ...systems,
        copySystem("system-beta", "beta", "draft"),
        copySystem("system-archive", "archive", "archived"),
      ],
      { suppressMissingObjectCountWarnings: true },
    );
    globalThis.__osuDojoDatabaseBundle = databaseBundle;

    const systemsHtml = renderToStaticMarkup(await DanSystemsPage());
    const draftHtml = renderToStaticMarkup(
      await withAnonymousRequestScope(() => DanCoursePage({
        params: Promise.resolve({ systemNameKey: "beta" }),
        searchParams: Promise.resolve({ course: SEEDED_COURSE_NAME_KEY }),
      })),
    );
    const draftCourse = await getCourseByNameKey("beta", SEEDED_COURSE_NAME_KEY);
    const archivedCourse = await getCourseByNameKey("archive", SEEDED_COURSE_NAME_KEY);

    assert.doesNotMatch(systemsHtml, /\/dan\/beta/);
    assert.doesNotMatch(systemsHtml, /\/dan\/archive/);
    assert.ok(draftCourse);
    assert.equal(archivedCourse, null);
    assert.match(draftHtml, /Draft/i);
    assert.match(draftHtml, /Runs on draft systems are not recorded/);
    assert.match(draftHtml, /!dojo start beta 1st/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeRenderedText(value: string) {
  return value.replace(/</g, "&lt;");
}

test("course run queries and page derive DNF for interrupted partial runs", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    const databaseBundle = await createTestDatabase(temp.url);
    const { db } = databaseBundle;
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);

    await storeCourseRunResult(
      {
        userId: 777,
        username: "DNFPlayer",
        courseId: course!.id,
        passed: false,
        startedAt: 1_800_000_000_000,
        completedAt: 1_800_000_010_000,
        matchId: null,
        maps: [
          {
            gameId: 1,
            beatmapId: course!.beatmaps[0]!.beatmapId,
            mods: course!.beatmaps[0]!.mods,
            passConditions: course!.beatmaps[0]!.passConditions,
            ordinal: 1,
            score: 900_000,
            rawScore: 900_000,
            playedMods: course!.beatmaps[0]!.mods,
            accuracy: 96,
            maxCombo: 700,
            count300: 900,
            count100: 60,
            count50: 5,
            countMiss: 1,
            passed: true,
            createdAt: 1_800_000_005_000,
          },
        ],
      },
      db,
    );

    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.runs[0]?.username, "DNFPlayer");
    assert.equal(results?.runs[0]?.status, "dnf");

    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = databaseBundle;

    const resultsHtml = renderToStaticMarkup(
      await withAnonymousRequestScope(() => DanCoursePage({
        params: Promise.resolve({
          systemNameKey: SEEDED_SYSTEM_NAME_KEY,
        }),
        searchParams: Promise.resolve({
          course: SEEDED_COURSE_NAME_KEY,
        }),
      })),
    );

    assert.match(resultsHtml, /DNFPlayer/);
    assert.match(resultsHtml, /status-dnf/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});
