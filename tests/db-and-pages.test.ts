import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir, type DanSystemSeed } from "@/db/courseLoader";
import {
  formatConditionCompact,
  formatScoreModel,
} from "@/lib/format";
import {
  getCourseByNameKey,
  listCoursesByDanSystemNameKey,
  listCourseRunsByNameKey,
  listDanSystemsWithCourses,
  storeCourseRunResult,
} from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import DanSystemsPage from "@/app/dan/page";
import HomePage from "@/app/page";
import DanCoursePage from "@/app/dan/[systemNameKey]/page";
import { createTempDatabaseUrl as createTempDatabaseUrlWithPrefix } from "./helpers/tempDatabase";

const createTempDatabaseUrl = () => createTempDatabaseUrlWithPrefix("osudojo-");

const SEEDED_SYSTEM_NAME_KEY = "test";
const SEEDED_COURSE_NAME_KEY = "1st";
const SEEDED_COURSE_SLUG = "test-1dan";
const SEEDED_SECOND_COURSE_SLUG = "test-2dan";

type SeedCourse = DanSystemSeed["courses"][number];
type SeedBeatmap = SeedCourse["beatmaps"][number];
type HydratedCourse = NonNullable<Awaited<ReturnType<typeof getCourseByNameKey>>>;

function addSampleBeatmapMetadata(systems: ReturnType<typeof cloneCourseSystems>) {
  const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);
  const secondCourse = systems[0]?.courses.find(
    (entry) => entry.slug === SEEDED_SECOND_COURSE_SLUG,
  );

  if (!seededCourse || !seededCourse.beatmaps[0] || !seededCourse.beatmaps[1] || !secondCourse?.beatmaps[0]) {
    throw new Error("Missing seeded test beatmaps.");
  }

  seededCourse.beatmaps[0] = {
    ...seededCourse.beatmaps[0],
    title: "test stage one",
    artist: "osu!dojo",
    difficultyName: "Opening",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/315/covers/cover.jpg",
  };
  seededCourse.beatmaps[1] = {
    ...seededCourse.beatmaps[1],
    title: "test stage two",
    artist: "osu!dojo",
    difficultyName: "Finale",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/259/covers/cover.jpg",
  };
  secondCourse.beatmaps[0] = {
    ...secondCourse.beatmaps[0],
    title: "test stage three",
    artist: "osu!dojo",
    difficultyName: "ScoreV1",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/4923775/covers/cover.jpg",
  };

  return systems;
}

function markSeededCourseDraft(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  systems: ReturnType<typeof cloneCourseSystems>,
) {
  db.$client
    .prepare("UPDATE dan_systems SET status = 'draft' WHERE slug = ?")
    .run(SEEDED_SYSTEM_NAME_KEY);

  const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);
  if (!seededCourse) {
    throw new Error("Missing seeded test course.");
  }
  systems[0]!.status = "draft";
  return seededCourse;
}

function replaceSeedBeatmap(
  course: SeedCourse,
  beatmapId: string,
  replace: (beatmap: SeedBeatmap) => SeedBeatmap,
) {
  const index = course.beatmaps.findIndex((beatmap) => beatmap.id === beatmapId);
  if (index === -1) {
    throw new Error(`Missing seeded beatmap ${beatmapId}.`);
  }

  course.beatmaps[index] = replace(course.beatmaps[index]!);
}

function requireCourseBeatmap(course: HydratedCourse, beatmapId: string) {
  const beatmap = course.beatmaps.find((entry) => entry.id === beatmapId);
  if (!beatmap) {
    throw new Error(`Missing course beatmap ${beatmapId}.`);
  }

  return beatmap;
}

test("seeded queries expose the sample course and runs", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = await listDanSystemsWithCourses(db);
    const systemCourses = await listCoursesByDanSystemNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      db,
    );
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(systems.length, 1);
    assert.equal(systemCourses.length, 2);
    assert.equal(systems[0]?.courses[0]?.slug, SEEDED_COURSE_SLUG);
    assert.equal(systems[0]?.courses[0]?.scoreModel, "scorev2");
    assert.equal(systems[0]?.courses[1]?.slug, SEEDED_SECOND_COURSE_SLUG);
    assert.equal(systems[0]?.courses[1]?.scoreModel, "scorev1");
    assert.ok(course);
    assert.equal(course.beatmaps.length, 2);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").freemod, true);
    assert.equal(course.scoreModel, "scorev2");
    assert.match(course.danSystemDescription, /Sample dan system/i);
    assert.equal(results?.runs.length, 0);
  } finally {
    temp.cleanup();
  }
});

test("course queries hydrate and normalize beatmap total object counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);

    let course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(course?.beatmaps[0]?.totalObjects, null);

    db.$client
      .prepare(
        `
        UPDATE beatmap_metadata
        SET total_objects = ?
        WHERE beatmap_id = (
          SELECT beatmap_id
          FROM beatmaps
          WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
            AND ordinal = ?
        )
        `,
      )
      .run(710, SEEDED_COURSE_SLUG, 1);

    course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(course?.beatmaps[0]?.totalObjects, 710);

    db.$client.pragma("ignore_check_constraints = ON");
    db.$client
      .prepare(
        `
        UPDATE beatmap_metadata
        SET total_objects = ?
        WHERE beatmap_id = (
          SELECT beatmap_id
          FROM beatmaps
          WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
            AND ordinal = ?
        )
        `,
      )
      .run(-1, SEEDED_COURSE_SLUG, 1);
    db.$client.pragma("ignore_check_constraints = OFF");

    course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(course?.beatmaps[0]?.totalObjects, null);
  } finally {
    temp.cleanup();
  }
});

test("createTestDatabase migrates old beatmaps tables with total object counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const sqlite = new Database(temp.filePath);
    sqlite.exec(`
      CREATE TABLE beatmaps (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        beatmap_id INTEGER NOT NULL,
        mods TEXT NOT NULL,
        pass_condition_type TEXT NOT NULL,
        pass_condition_threshold REAL NOT NULL,
        ordinal INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        artist TEXT NOT NULL DEFAULT '',
        difficulty_name TEXT NOT NULL DEFAULT '',
        mapper TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        annotations TEXT NOT NULL DEFAULT '[]'
      );
    `);
    sqlite.close();

    const { db, sqlite: migratedSqlite } = await createTestDatabase(temp.url);
    const columns = (
      migratedSqlite.pragma("table_info(beatmaps)") as { name: string }[]
    ).map((column) => column.name);
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(columns.includes("total_objects"));
    assert.equal(course?.beatmaps[0]?.totalObjects, null);
  } finally {
    temp.cleanup();
  }
});

test("createTestDatabase backfills legacy pass condition columns", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const sqlite = new Database(temp.filePath);
    sqlite.exec(`
      CREATE TABLE dan_systems (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'current'
      );
      CREATE TABLE courses (
        id TEXT PRIMARY KEY,
        dan_system_id TEXT NOT NULL REFERENCES dan_systems(id),
        creator_user_id INTEGER,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        ordinal INTEGER NOT NULL,
        score_model TEXT NOT NULL DEFAULT 'scorev2',
        overall_pass_type TEXT,
        overall_pass_threshold REAL,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(dan_system_id, slug)
      );
      CREATE TABLE beatmaps (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id),
        beatmap_id INTEGER NOT NULL,
        mods TEXT NOT NULL,
        pass_condition_type TEXT NOT NULL,
        pass_condition_threshold REAL NOT NULL,
        ordinal INTEGER NOT NULL,
        annotations TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        course_id TEXT NOT NULL REFERENCES courses(id),
        passed INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        match_id INTEGER
      );
      CREATE TABLE map_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        game_id INTEGER,
        beatmap_id INTEGER NOT NULL,
        mods TEXT NOT NULL,
        pass_condition_type TEXT NOT NULL,
        pass_condition_threshold REAL NOT NULL,
        ordinal INTEGER NOT NULL,
        score INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        max_combo INTEGER NOT NULL,
        count_300 INTEGER NOT NULL,
        count_100 INTEGER NOT NULL,
        count_50 INTEGER NOT NULL,
        count_miss INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      INSERT INTO dan_systems (id, name, slug, description, status)
      VALUES ('system-old', 'old', 'old', 'old', 'draft');
      INSERT INTO courses (
        id,
        dan_system_id,
        name,
        slug,
        description,
        ordinal,
        score_model,
        overall_pass_type,
        overall_pass_threshold
      )
      VALUES ('course-old', 'system-old', 'old', 'old', 'old', 1, 'scorev2', 'acc', 95);
      INSERT INTO beatmaps (
        id,
        course_id,
        beatmap_id,
        mods,
        pass_condition_type,
        pass_condition_threshold,
        ordinal
      )
      VALUES ('beatmap-old', 'course-old', 1, '', 'score', 10000, 1);
      INSERT INTO runs (
        id,
        user_id,
        username,
        course_id,
        passed,
        started_at,
        completed_at
      )
      VALUES ('run-old', 1, 'OldPlayer', 'course-old', 1, 1, 2);
      INSERT INTO map_results (
        id,
        run_id,
        beatmap_id,
        mods,
        pass_condition_type,
        pass_condition_threshold,
        ordinal,
        score,
        accuracy,
        max_combo,
        count_300,
        count_100,
        count_50,
        count_miss,
        passed
      )
      VALUES ('map-result-old', 'run-old', 1, '', 'acc', 95, 1, 10000, 96, 100, 1, 0, 0, 0, 1);
    `);
    sqlite.close();

    const { sqlite: migratedSqlite } = await createTestDatabase(temp.url);
    const course = migratedSqlite
      .prepare("SELECT overall_pass_conditions FROM courses WHERE id = ?")
      .get("course-old") as { overall_pass_conditions: string };
    const beatmap = migratedSqlite
      .prepare("SELECT pass_conditions FROM beatmaps WHERE id = ?")
      .get("beatmap-old") as { pass_conditions: string };
    const mapResult = migratedSqlite
      .prepare("SELECT pass_conditions, raw_score, played_mods FROM map_results WHERE id = ?")
      .get("map-result-old") as {
        pass_conditions: string;
        raw_score: number;
        played_mods: string;
      };
    const beatmapColumns = (
      migratedSqlite.pragma("table_info(beatmaps)") as { name: string }[]
    ).map((column) => column.name);
    const mapResultColumns = (
      migratedSqlite.pragma("table_info(map_results)") as { name: string }[]
    ).map((column) => column.name);

    assert.deepEqual(JSON.parse(course.overall_pass_conditions), [
      { type: "courseAccuracy", threshold: 95 },
    ]);
    assert.deepEqual(JSON.parse(beatmap.pass_conditions), [
      { type: "score", threshold: 10000 },
    ]);
    assert.deepEqual(JSON.parse(mapResult.pass_conditions), [
      { type: "accuracy", threshold: 95 },
    ]);
    assert.equal(mapResult.raw_score, 10000);
    assert.equal(mapResult.played_mods, "");
    assert.equal(beatmapColumns.includes("freemod"), true);
    assert.equal(mapResultColumns.includes("raw_score"), true);
    assert.equal(mapResultColumns.includes("played_mods"), true);
    assert.equal(beatmapColumns.includes("pass_condition_type"), false);
  } finally {
    temp.cleanup();
  }
});

test("course reads reject stale map pass condition types", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);

    db.$client
      .prepare(
        `
        UPDATE beatmaps
        SET pass_conditions = ?
        WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
          AND ordinal = ?
        `,
      )
      .run(
        JSON.stringify([{ type: "acc", threshold: 95 }]),
        SEEDED_COURSE_SLUG,
        1,
      );

    await assert.rejects(
      () =>
        getCourseByNameKey(
          SEEDED_SYSTEM_NAME_KEY,
          SEEDED_COURSE_NAME_KEY,
          db,
        ),
      /map pass condition type "acc" is not valid/,
    );
  } finally {
    temp.cleanup();
  }
});

test("course reads reject map-only types in course pass conditions", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);

    db.$client
      .prepare("UPDATE courses SET overall_pass_conditions = ? WHERE slug = ?")
      .run(
        JSON.stringify([{ type: "accuracy", threshold: 95 }]),
        SEEDED_COURSE_SLUG,
      );

    await assert.rejects(
      () =>
        getCourseByNameKey(
          SEEDED_SYSTEM_NAME_KEY,
          SEEDED_COURSE_NAME_KEY,
          db,
        ),
      /course pass condition type "accuracy" is not valid/,
    );
  } finally {
    temp.cleanup();
  }
});

test("pages render seeded course data from SQLite", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env.DATABASE_URL = temp.url;
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
      await DanCoursePage({
        params: Promise.resolve({
          systemNameKey: SEEDED_SYSTEM_NAME_KEY,
        }),
        searchParams: Promise.resolve({
          course: SEEDED_COURSE_NAME_KEY,
        }),
      }),
    );
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
    );

    assert.ok(course);

    assert.match(homeHtml, /Browse dan systems/);
    assert.doesNotMatch(homeHtml, /Open system/);
    assert.match(systemsHtml, /test/i);
    assert.match(systemsHtml, /\/dan\/test/);
    assert.match(systemsHtml, /Each dan system groups related courses under one scoring model\./);
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
    process.env.DATABASE_URL = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("catalog hides drafts but exact-key draft detail renders", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env.DATABASE_URL = temp.url;
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
      await DanCoursePage({
        params: Promise.resolve({ systemNameKey: "beta" }),
        searchParams: Promise.resolve({ course: SEEDED_COURSE_NAME_KEY }),
      }),
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
    process.env.DATABASE_URL = previousDatabaseUrl;
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
  const previousDatabaseUrl = process.env.DATABASE_URL;
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

    process.env.DATABASE_URL = temp.url;
    globalThis.__osuDojoDatabaseBundle = databaseBundle;

    const resultsHtml = renderToStaticMarkup(
      await DanCoursePage({
        params: Promise.resolve({
          systemNameKey: SEEDED_SYSTEM_NAME_KEY,
        }),
        searchParams: Promise.resolve({
          course: SEEDED_COURSE_NAME_KEY,
        }),
      }),
    );

    assert.match(resultsHtml, /DNFPlayer/);
    assert.match(resultsHtml, /status-dnf/);
  } finally {
    process.env.DATABASE_URL = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("seedDatabase synchronizes updated draft beatmaps on an existing SQLite file", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const originalCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, systems);

    assert.ok(originalCourse);
    assert.ok(seededCourse);

    const updatedBeatmapId =
      requireCourseBeatmap(originalCourse, "beatmap-test-1").beatmapId + 1000;
    const newBeatmapId = updatedBeatmapId + 1;

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    replaceSeedBeatmap(seededCourse, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: updatedBeatmapId,
    }));
    seededCourse.beatmaps.push({
      id: "beatmap-test-3",
      beatmapId: newBeatmapId,
      mods: "DT",
      freemod: false,
      passConditions: [{ type: "accuracy", threshold: 50 }],
      ordinal: 3,
      title: "test stage three",
      artist: "osu!dojo",
      difficultyName: "Encore",
      mapper: "staff",
      coverUrl: "https://assets.ppy.sh/beatmaps/3/covers/cover.jpg",
      annotations: ["stamina", "extra stage"],
    });

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const updatedResults = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(updatedCourse);
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-1").beatmapId,
      updatedBeatmapId,
    );
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-2").beatmapId,
      requireCourseBeatmap(originalCourse, "beatmap-test-2").beatmapId,
    );
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-3").beatmapId,
      newBeatmapId,
    );
    assert.equal(updatedResults?.runs.length, 0);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase rejects gameplay edits on current systems", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

    assert.ok(seededCourse);
    seededCourse!.beatmaps[0] = {
      ...seededCourse!.beatmaps[0]!,
      passConditions: [{ type: "accuracy", threshold: 99 }],
    };

    await assert.rejects(
      () => seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true }),
      /immutable gameplay changes.*beatmaps/i,
    );
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase allows current systems to roll over to legacy keys", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const system = systems[0];

    assert.ok(system);
    system!.name = "test 2025";
    system!.slug = "test-2025";
    system!.status = "legacy";

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const legacyCourse = await getCourseByNameKey(
      "test-2025",
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const oldKeyCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(legacyCourse?.slug, SEEDED_COURSE_SLUG);
    assert.equal(oldKeyCourse, null);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase rejects disallowed system status transitions", async () => {
  const cases: Array<{
    name: string;
    existing: "current" | "legacy" | "draft" | "archived";
    incoming: "current" | "legacy" | "draft" | "archived";
  }> = [
    { name: "current to draft", existing: "current", incoming: "draft" },
    { name: "legacy to draft", existing: "legacy", incoming: "draft" },
    { name: "draft to legacy", existing: "draft", incoming: "legacy" },
    { name: "archived to current", existing: "archived", incoming: "current" },
    { name: "archived to legacy", existing: "archived", incoming: "legacy" },
    { name: "archived to draft", existing: "archived", incoming: "draft" },
  ];

  for (const transitionCase of cases) {
    const temp = createTempDatabaseUrl();

    try {
      const { db } = await createTestDatabase(temp.url);
      db.$client
        .prepare("UPDATE dan_systems SET status = ? WHERE slug = ?")
        .run(transitionCase.existing, SEEDED_SYSTEM_NAME_KEY);

      const systems = cloneCourseSystems(
        loadCoursesFromDir(path.join(process.cwd(), "data/courses")),
      );
      systems[0]!.status = transitionCase.incoming;

      await assert.rejects(
        () => seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true }),
        new RegExp(
          `cannot transition from ${transitionCase.existing} to ${transitionCase.incoming}`,
        ),
        transitionCase.name,
      );
    } finally {
      temp.cleanup();
    }
  }
});

test("seedDatabase allows draft to publish with simultaneous gameplay edits", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    db.$client
      .prepare("UPDATE dan_systems SET status = 'draft' WHERE slug = ?")
      .run(SEEDED_SYSTEM_NAME_KEY);

    const originalCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systems = cloneCourseSystems(
      loadCoursesFromDir(path.join(process.cwd(), "data/courses")),
    );
    const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

    assert.ok(originalCourse);
    assert.ok(seededCourse);

    systems[0]!.status = "current";
    replaceSeedBeatmap(seededCourse!, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: requireCourseBeatmap(originalCourse!, "beatmap-test-1").beatmapId + 10_000,
    }));

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systemRow = db.$client
      .prepare("SELECT status FROM dan_systems WHERE slug = ?")
      .get(SEEDED_SYSTEM_NAME_KEY) as { status: string };

    assert.equal(systemRow.status, "current");
    assert.ok(updatedCourse);
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-1").beatmapId,
      seededCourse!.beatmaps.find((beatmap) => beatmap.id === "beatmap-test-1")!.beatmapId,
    );
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase reuses existing resolved metadata when course JSON omits it", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await seedDatabase(
      db,
      addSampleBeatmapMetadata(
        cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
      ),
      { suppressMissingObjectCountWarnings: true },
    );

    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);
    let resolverCalls = 0;

    assert.ok(seededCourse);

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    for (const beatmap of seededCourse.beatmaps) {
      beatmap.title = "";
      beatmap.artist = "";
      beatmap.difficultyName = "";
      beatmap.mapper = "";
      beatmap.coverUrl = "";
    }

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => {
        resolverCalls += 1;
        return { ok: false, reason: "resolver should not be called" };
      },
    });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(resolverCalls, 3);
    assert.ok(updatedCourse);
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-1").title, "test stage one");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-2").title, "test stage two");
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase preserves seeded metadata while resolving total object counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: null,
          totalObjects: 500,
        },
      }),
    });

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").title, "test stage one");
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, 500);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase reuses existing total object counts without clobbering JSON metadata", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Resolved title",
            artist: "Resolved artist",
            difficultyName: "Resolved difficulty",
            mapper: "Resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
          },
          totalObjects: 500,
        },
      }),
    });

    await seedDatabase(
      db,
      addSampleBeatmapMetadata(
        cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
      ),
      { suppressMissingObjectCountWarnings: true },
    );

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").title, "test stage one");
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, 500);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase does not reuse total object counts after beatmap id changes", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Resolved title",
            artist: "Resolved artist",
            difficultyName: "Resolved difficulty",
            mapper: "Resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
          },
          totalObjects: 500,
        },
      }),
    });

    const updatedSystems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, updatedSystems);

    assert.ok(seededCourse);
    replaceSeedBeatmap(seededCourse!, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: 123_456,
    }));

    await seedDatabase(db, updatedSystems, { suppressMissingObjectCountWarnings: true });

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").beatmapId, 123_456);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, null);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase keeps existing total object counts when resolver returns null counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Initial resolved title",
            artist: "Initial resolved artist",
            difficultyName: "Initial resolved difficulty",
            mapper: "Initial resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/500/covers/cover.jpg",
          },
          totalObjects: 500,
        },
      }),
    });

    db.$client
      .prepare(
        `
        UPDATE beatmap_metadata
        SET title = '', artist = '', difficulty_name = '', mapper = '', cover_url = ''
        `,
      )
      .run();

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Resolved title",
            artist: "Resolved artist",
            difficultyName: "Resolved difficulty",
            mapper: "Resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
          },
          totalObjects: null,
        },
      }),
    });

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").title, "Resolved title");
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, 500);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase stores defaults for missing metadata when no resolver is configured", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, systems);

    assert.ok(seededCourse);

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    replaceSeedBeatmap(seededCourse, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: 8_888,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    }));

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(updatedCourse);
    const updatedBeatmap = requireCourseBeatmap(updatedCourse, "beatmap-test-1");
    assert.equal(updatedBeatmap.title, "");
    assert.equal(updatedBeatmap.artist, "");
    assert.equal(updatedBeatmap.difficultyName, "");
    assert.equal(updatedBeatmap.mapper, "");
    assert.equal(updatedBeatmap.coverUrl, "");
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase resolves missing metadata and stores defaults on resolver failure", async () => {
  const temp = createTempDatabaseUrl();
  const originalWarn = console.warn;
  const warnings: string[] = [];

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, systems);
    const resolverBeatmapIds: number[] = [];

    assert.ok(seededCourse);

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    replaceSeedBeatmap(seededCourse, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: 9_999,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    }));
    replaceSeedBeatmap(seededCourse, "beatmap-test-2", (beatmap) => ({
      ...beatmap,
      beatmapId: 10_000,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    }));

    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async (beatmapId) => {
        resolverBeatmapIds.push(beatmapId);

        return beatmapId === 9_999
          ? {
              ok: true,
              data: {
                metadata: {
                  title: "Resolved title",
                  artist: "Resolved artist",
                  difficultyName: "Resolved difficulty",
                  mapper: "Resolved mapper",
                  coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
                },
                totalObjects: null,
              },
            }
          : { ok: false, reason: "missing metadata" };
      },
    });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.deepEqual(resolverBeatmapIds, [9_999, 10_000, 4_923_775]);
    assert.ok(updatedCourse);
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-1").title, "Resolved title");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-1").artist, "Resolved artist");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-2").title, "");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-2").artist, "");
    assert.ok(warnings.some((warning) => /10,000|10000/.test(warning)));
  } finally {
    console.warn = originalWarn;
    temp.cleanup();
  }
});
