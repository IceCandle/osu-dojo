import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import {
  getDanCourseByRoute,
  listDanCoursesBySystemSlug,
  listDanResultsByRoute,
  listDanSystemsWithDans,
  storeDanRunResult,
} from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import DanSystemsPage from "@/app/dan/page";
import HomePage from "@/app/page";
import DanCoursePage from "@/app/dan/[systemSlug]/page";

function createTempDatabaseUrl() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "osudojo-"));
  return {
    filePath: path.join(directory, "dojo.sqlite"),
    url: `file:${path.join(directory, "dojo.sqlite")}`,
    cleanup() {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

const SEEDED_SYSTEM_SLUG = "test";
const SEEDED_COURSE_SLUG = "test-1dan";

test("seeded queries expose the sample dan and results", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = await listDanSystemsWithDans(db);
    const systemCourses = await listDanCoursesBySystemSlug(SEEDED_SYSTEM_SLUG, db);
    const course = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);
    const results = await listDanResultsByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);

    assert.equal(systems.length, 1);
    assert.equal(systemCourses.length, 1);
    assert.equal(systems[0]?.dans[0]?.courseSlug, SEEDED_COURSE_SLUG);
    assert.equal(systems[0]?.dans[0]?.scoreModel, "scorev2");
    assert.equal(course?.beatmaps.length, 2);
    assert.equal(course?.scoreModel, "scorev2");
    assert.match(course?.danSystemDescription ?? "", /Sample dan system/i);
    assert.equal(results?.results.length, 1);
    assert.equal(results?.results[0]?.username, "DemoPlayer");
    assert.equal(results?.results[0]?.status, "pass");
  } finally {
    temp.cleanup();
  }
});

test("pages render seeded dan data from SQLite", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env.DATABASE_URL = temp.url;
    globalThis.__osuDojoDatabaseBundle = undefined;

    const homeHtml = renderToStaticMarkup(await HomePage());
    const systemsHtml = renderToStaticMarkup(await DanSystemsPage());
    const courseHtml = renderToStaticMarkup(
      await DanCoursePage({
        params: Promise.resolve({
          systemSlug: SEEDED_SYSTEM_SLUG,
        }),
        searchParams: Promise.resolve({
          course: SEEDED_COURSE_SLUG,
        }),
      }),
    );
    const course = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG);

    assert.match(homeHtml, /Browse dan systems/);
    assert.doesNotMatch(homeHtml, /Open system/);
    assert.match(systemsHtml, /test/i);
    assert.match(systemsHtml, /\/dan\/test/);
    assert.match(systemsHtml, /Each system groups related dan courses under one scoring model\./);
    assert.match(courseHtml, /test stage one/i);
    assert.match(courseHtml, /!dojo start test test-1dan/);
    assert.match(courseHtml, /Sample dan system for the MVP\./);
    assert.match(courseHtml, new RegExp(course?.beatmaps[0]?.difficultyName ?? ""));
    assert.match(courseHtml, /ScoreV2/);
    assert.match(courseHtml, /20\.00%\+/);
    assert.match(courseHtml, /10\.00%\+/);
    assert.match(courseHtml, /10,000\+ score/);
    assert.match(courseHtml, /DemoPlayer/);
    assert.match(courseHtml, /Top runs/);
    assert.match(courseHtml, /status-pass/);
    assert.doesNotMatch(courseHtml, /\b\d{1,2}:\d{2}\b/);
  } finally {
    process.env.DATABASE_URL = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("results queries and page derive DNF for interrupted partial runs", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    const { db } = await createTestDatabase(temp.url);
    const course = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);

    assert.ok(course);

    await storeDanRunResult(
      {
        userId: 777,
        username: "DNFPlayer",
        danId: course!.id,
        passed: false,
        startedAt: 1_800_000_000_000,
        completedAt: 1_800_000_010_000,
        matchId: null,
        maps: [
          {
            gameId: 1,
            beatmapId: course!.beatmaps[0]!.beatmapId,
            mods: course!.beatmaps[0]!.mods,
            passConditionType: course!.beatmaps[0]!.passConditionType,
            passConditionThreshold: course!.beatmaps[0]!.passConditionThreshold,
            ordinal: 1,
            score: 900_000,
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

    const results = await listDanResultsByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);
    assert.equal(results?.results[0]?.username, "DNFPlayer");
    assert.equal(results?.results[0]?.status, "dnf");

    process.env.DATABASE_URL = temp.url;
    globalThis.__osuDojoDatabaseBundle = undefined;

    const resultsHtml = renderToStaticMarkup(
      await DanCoursePage({
        params: Promise.resolve({
          systemSlug: SEEDED_SYSTEM_SLUG,
        }),
        searchParams: Promise.resolve({
          course: SEEDED_COURSE_SLUG,
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

test("seedDatabase synchronizes updated seeded beatmaps on an existing SQLite file", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const originalCourse = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const dan = systems[0]?.dans.find((entry) => entry.courseSlug === SEEDED_COURSE_SLUG);

    assert.ok(originalCourse);
    assert.ok(dan);

    const updatedBeatmapId = (originalCourse?.beatmaps[0]?.beatmapId ?? 0) + 1000;
    const newBeatmapId = updatedBeatmapId + 1;

    if (!dan) {
      throw new Error("Missing seeded test dan.");
    }

    dan.beatmaps[0] = {
      ...dan.beatmaps[0],
      beatmapId: updatedBeatmapId,
    };
    dan.beatmaps.push({
      id: "beatmap-test-3",
      beatmapId: newBeatmapId,
      mods: "DT",
      passConditionType: "acc",
      passConditionThreshold: 50,
      ordinal: 3,
      title: "test stage three",
      artist: "osu!dojo",
      difficultyName: "Encore",
      mapper: "staff",
      coverUrl: "https://assets.ppy.sh/beatmaps/3/covers/cover.jpg",
      annotations: ["stamina", "extra stage"],
    });

    await seedDatabase(db, systems);

    const updatedCourse = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);
    const updatedResults = await listDanResultsByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);

    assert.deepEqual(
      updatedCourse?.beatmaps.map((beatmap) => beatmap.beatmapId),
      [
        updatedBeatmapId,
        originalCourse?.beatmaps[1]?.beatmapId,
        newBeatmapId,
      ],
    );
    assert.equal(updatedResults?.results.length, 1);
    assert.deepEqual(
      updatedResults?.results[0]?.maps.map((map) => map.beatmapId),
      originalCourse?.beatmaps.map((beatmap) => beatmap.beatmapId),
    );
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase reuses existing resolved metadata when course JSON omits it", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const dan = systems[0]?.dans.find((entry) => entry.courseSlug === SEEDED_COURSE_SLUG);
    let resolverCalls = 0;

    assert.ok(dan);

    if (!dan) {
      throw new Error("Missing seeded test dan.");
    }

    for (const beatmap of dan.beatmaps) {
      beatmap.title = "";
      beatmap.artist = "";
      beatmap.difficultyName = "";
      beatmap.mapper = "";
      beatmap.coverUrl = "";
    }

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      resolveMetadata: async () => {
        resolverCalls += 1;
        return { ok: false, reason: "resolver should not be called" };
      },
    });

    const updatedCourse = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);

    assert.equal(resolverCalls, 0);
    assert.equal(updatedCourse?.beatmaps[0]?.title, "test stage one");
    assert.equal(updatedCourse?.beatmaps[1]?.title, "test stage two");
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase stores defaults for missing metadata when no resolver is configured", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const dan = systems[0]?.dans.find((entry) => entry.courseSlug === SEEDED_COURSE_SLUG);

    assert.ok(dan);

    if (!dan) {
      throw new Error("Missing seeded test dan.");
    }

    dan.beatmaps[0] = {
      ...dan.beatmaps[0],
      beatmapId: 8_888,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    };

    await seedDatabase(db, systems);

    const updatedCourse = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);

    assert.equal(updatedCourse?.beatmaps[0]?.title, "");
    assert.equal(updatedCourse?.beatmaps[0]?.artist, "");
    assert.equal(updatedCourse?.beatmaps[0]?.difficultyName, "");
    assert.equal(updatedCourse?.beatmaps[0]?.mapper, "");
    assert.equal(updatedCourse?.beatmaps[0]?.coverUrl, "");
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
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const dan = systems[0]?.dans.find((entry) => entry.courseSlug === SEEDED_COURSE_SLUG);
    const resolverBeatmapIds: number[] = [];

    assert.ok(dan);

    if (!dan) {
      throw new Error("Missing seeded test dan.");
    }

    dan.beatmaps[0] = {
      ...dan.beatmaps[0],
      beatmapId: 9_999,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    };
    dan.beatmaps[1] = {
      ...dan.beatmaps[1],
      beatmapId: 10_000,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    };

    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      resolveMetadata: async (beatmapId) => {
        resolverBeatmapIds.push(beatmapId);

        return beatmapId === 9_999
          ? {
              ok: true,
              data: {
                title: "Resolved title",
                artist: "Resolved artist",
                difficultyName: "Resolved difficulty",
                mapper: "Resolved mapper",
                coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
              },
            }
          : { ok: false, reason: "missing metadata" };
      },
    });

    const updatedCourse = await getDanCourseByRoute(SEEDED_SYSTEM_SLUG, SEEDED_COURSE_SLUG, db);

    assert.deepEqual(resolverBeatmapIds, [9_999, 10_000]);
    assert.equal(updatedCourse?.beatmaps[0]?.title, "Resolved title");
    assert.equal(updatedCourse?.beatmaps[0]?.artist, "Resolved artist");
    assert.equal(updatedCourse?.beatmaps[1]?.title, "");
    assert.equal(updatedCourse?.beatmaps[1]?.artist, "");
    assert.match(warnings[0] ?? "", /10,000|10000/);
  } finally {
    console.warn = originalWarn;
    temp.cleanup();
  }
});

test("database bootstrap migrates legacy score fields and adds archive columns", async () => {
  const temp = createTempDatabaseUrl();
  const sqlite = new Database(temp.filePath);

  try {
    sqlite.exec(`
      CREATE TABLE dan_systems (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL
      );
      CREATE TABLE dans (
        id TEXT PRIMARY KEY,
        dan_system_id TEXT NOT NULL REFERENCES dan_systems(id),
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        ordinal INTEGER NOT NULL,
        overall_pass_type TEXT,
        overall_pass_threshold REAL
      );
      CREATE TABLE dan_beatmaps (
        id TEXT PRIMARY KEY,
        dan_id TEXT NOT NULL REFERENCES dans(id),
        beatmap_id INTEGER NOT NULL,
        mods TEXT NOT NULL,
        pass_condition_type TEXT NOT NULL,
        pass_condition_threshold REAL NOT NULL,
        ordinal INTEGER NOT NULL
      );
      CREATE TABLE results (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        dan_id TEXT NOT NULL REFERENCES dans(id),
        passed INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      );
      CREATE TABLE map_results (
        id TEXT PRIMARY KEY,
        result_id TEXT NOT NULL REFERENCES results(id),
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
        created_at INTEGER NOT NULL
      );
    `);

    sqlite
      .prepare(
        "INSERT INTO dan_systems (id, name, slug, description) VALUES (?, ?, ?, ?)",
      )
      .run("legacy-system", "legacy", "legacy", "legacy");
    sqlite
      .prepare(
        "INSERT INTO dans (id, dan_system_id, name, slug, description, ordinal, overall_pass_type, overall_pass_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("legacy-dan", "legacy-system", "legacy-dan", "legacy-dan", "legacy", 1, "sv2", 1000);
    sqlite
      .prepare(
        "INSERT INTO dan_beatmaps (id, dan_id, beatmap_id, mods, pass_condition_type, pass_condition_threshold, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("legacy-map", "legacy-dan", 123, "", "sv2", 500, 1);
    sqlite
      .prepare(
        "INSERT INTO results (id, user_id, username, dan_id, passed, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("legacy-result", 1, "Legacy", "legacy-dan", 1, 1000, 2000);
    sqlite
      .prepare(
        "INSERT INTO map_results (id, result_id, beatmap_id, mods, pass_condition_type, pass_condition_threshold, ordinal, score, accuracy, max_combo, count_300, count_100, count_50, count_miss, passed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("legacy-map-result", "legacy-result", 123, "", "sv2", 500, 1, 700, 95, 100, 1, 0, 0, 0, 1, 1500);
  } finally {
    sqlite.close();
  }

  try {
    const first = await createTestDatabase(temp.url);
    first.sqlite.close();
    const second = await createTestDatabase(temp.url);
    second.sqlite.close();

    const migrated = new Database(temp.filePath);

    try {
      const danColumns = migrated.prepare("PRAGMA table_info(dans)").all() as Array<{
        name: string;
      }>;
      const resultColumns = migrated.prepare("PRAGMA table_info(results)").all() as Array<{
        name: string;
      }>;
      const mapColumns = migrated.prepare("PRAGMA table_info(map_results)").all() as Array<{
        name: string;
      }>;
      const danRow = migrated
        .prepare(
          "SELECT course_slug AS courseSlug, score_model AS scoreModel, overall_pass_type AS overallPassType FROM dans WHERE id = ?",
        )
        .get("legacy-dan") as {
        courseSlug: string;
        scoreModel: string;
        overallPassType: string;
      };
      const beatmapRow = migrated
        .prepare(
          "SELECT pass_condition_type AS passConditionType, annotations FROM dan_beatmaps WHERE id = ?",
        )
        .get("legacy-map") as { passConditionType: string; annotations: string };
      const mapResultRow = migrated
        .prepare(
          "SELECT pass_condition_type AS passConditionType FROM map_results WHERE id = ?",
        )
        .get("legacy-map-result") as { passConditionType: string };

      assert.ok(danColumns.some((column) => column.name === "score_model"));
      assert.ok(danColumns.some((column) => column.name === "course_slug"));
      assert.ok(resultColumns.some((column) => column.name === "match_id"));
      assert.ok(mapColumns.some((column) => column.name === "game_id"));
      assert.equal(danRow.courseSlug, "legacy-dan");
      assert.equal(danRow.scoreModel, "scorev2");
      assert.equal(danRow.overallPassType, "score");
      assert.equal(beatmapRow.passConditionType, "score");
      assert.equal(beatmapRow.annotations, "[]");
      assert.equal(mapResultRow.passConditionType, "score");
    } finally {
      migrated.close();
    }
  } finally {
    temp.cleanup();
  }
});
