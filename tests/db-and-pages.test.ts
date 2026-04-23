import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import {
  formatConditionCompact,
  formatScoreModel,
} from "@/lib/format";
import {
  getCourseByNameKey,
  getDraftCourseByNameKey,
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
    .prepare("UPDATE courses SET status = 'draft', published_at = NULL WHERE slug = ?")
    .run(SEEDED_COURSE_SLUG);

  const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);
  if (!seededCourse) {
    throw new Error("Missing seeded test course.");
  }
  seededCourse.status = "draft";
  return seededCourse;
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
    assert.equal(course?.beatmaps.length, 2);
    assert.equal(course?.scoreModel, "scorev2");
    assert.match(course?.danSystemDescription ?? "", /Sample dan system/i);
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
    if (course.overallPassType && course.overallPassThreshold !== null) {
      assert.match(
        courseHtml,
        new RegExp(
          escapeRegExp(
            formatConditionCompact(
              course.overallPassType,
              course.overallPassThreshold,
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
            formatConditionCompact(
              beatmap.passConditionType,
              beatmap.passConditionThreshold,
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

    const updatedBeatmapId = (originalCourse?.beatmaps[0]?.beatmapId ?? 0) + 1000;
    const newBeatmapId = updatedBeatmapId + 1;

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    seededCourse.beatmaps[0] = {
      ...seededCourse.beatmaps[0],
      beatmapId: updatedBeatmapId,
    };
    seededCourse.beatmaps.push({
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

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getDraftCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const updatedResults = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.deepEqual(
      updatedCourse?.beatmaps.map((beatmap) => beatmap.beatmapId),
      [
        updatedBeatmapId,
        originalCourse?.beatmaps[1]?.beatmapId,
        newBeatmapId,
      ],
    );
    assert.equal(updatedResults, null);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase rejects gameplay edits on published courses", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

    assert.ok(seededCourse);
    seededCourse!.beatmaps[0] = {
      ...seededCourse!.beatmaps[0]!,
      passConditionThreshold: 99,
    };

    await assert.rejects(
      () => seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true }),
      /gameplay fields are immutable after publish.*beatmaps/i,
    );
  } finally {
    temp.cleanup();
  }
});

test("course aliases redirect archived names to successor courses", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const system = systems[0];
    const originalCourse = system?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

    assert.ok(system);
    assert.ok(originalCourse);
    originalCourse!.status = "archived";

    system!.courses.push({
      ...originalCourse!,
      id: "course-test-1dan-2026",
      name: "1st 2026",
      slug: "test-1dan-2026",
      status: "published",
      aliases: ["1st"],
      beatmaps: originalCourse!.beatmaps.map((beatmap) => ({
        ...beatmap,
        id: `beatmap-test-1dan-2026-${beatmap.ordinal}`,
      })),
    });

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const redirectedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systemCourses = await listCoursesByDanSystemNameKey(SEEDED_SYSTEM_NAME_KEY, db);

    assert.equal(redirectedCourse?.slug, "test-1dan-2026");
    assert.deepEqual(
      systemCourses.map((course) => course.slug),
      ["test-1dan-2026", SEEDED_SECOND_COURSE_SLUG],
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
    assert.equal(updatedCourse?.beatmaps[0]?.title, "test stage one");
    assert.equal(updatedCourse?.beatmaps[1]?.title, "test stage two");
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

    assert.equal(course?.beatmaps[0]?.title, "test stage one");
    assert.equal(course?.beatmaps[0]?.totalObjects, 500);
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

    assert.equal(course?.beatmaps[0]?.title, "test stage one");
    assert.equal(course?.beatmaps[0]?.totalObjects, 500);
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
    seededCourse!.beatmaps[0] = {
      ...seededCourse!.beatmaps[0]!,
      beatmapId: 123_456,
    };

    await seedDatabase(db, updatedSystems, { suppressMissingObjectCountWarnings: true });

    const course = await getDraftCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(course?.beatmaps[0]?.beatmapId, 123_456);
    assert.equal(course?.beatmaps[0]?.totalObjects, null);
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

    assert.equal(course?.beatmaps[0]?.title, "Resolved title");
    assert.equal(course?.beatmaps[0]?.totalObjects, 500);
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

    seededCourse.beatmaps[0] = {
      ...seededCourse.beatmaps[0],
      beatmapId: 8_888,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    };

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getDraftCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

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
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, systems);
    const resolverBeatmapIds: number[] = [];

    assert.ok(seededCourse);

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    seededCourse.beatmaps[0] = {
      ...seededCourse.beatmaps[0],
      beatmapId: 9_999,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    };
    seededCourse.beatmaps[1] = {
      ...seededCourse.beatmaps[1],
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

    const updatedCourse = await getDraftCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.deepEqual(resolverBeatmapIds, [9_999, 10_000, 4_923_775]);
    assert.equal(updatedCourse?.beatmaps[0]?.title, "Resolved title");
    assert.equal(updatedCourse?.beatmaps[0]?.artist, "Resolved artist");
    assert.equal(updatedCourse?.beatmaps[1]?.title, "");
    assert.equal(updatedCourse?.beatmaps[1]?.artist, "");
    assert.ok(warnings.some((warning) => /10,000|10000/.test(warning)));
  } finally {
    console.warn = originalWarn;
    temp.cleanup();
  }
});
