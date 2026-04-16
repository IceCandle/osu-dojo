import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import {
  getDanCourseByNameKey,
  listDanCoursesBySystemNameKey,
  listDanResultsByNameKey,
  listDanSystemsWithDans,
  storeDanRunResult,
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
  const dan = systems[0]?.dans.find((entry) => entry.courseSlug === SEEDED_COURSE_SLUG);
  const secondDan = systems[0]?.dans.find(
    (entry) => entry.courseSlug === SEEDED_SECOND_COURSE_SLUG,
  );

  if (!dan || !dan.beatmaps[0] || !dan.beatmaps[1] || !secondDan?.beatmaps[0]) {
    throw new Error("Missing seeded test beatmaps.");
  }

  dan.beatmaps[0] = {
    ...dan.beatmaps[0],
    title: "test stage one",
    artist: "osu!dojo",
    difficultyName: "Opening",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/315/covers/cover.jpg",
  };
  dan.beatmaps[1] = {
    ...dan.beatmaps[1],
    title: "test stage two",
    artist: "osu!dojo",
    difficultyName: "Finale",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/259/covers/cover.jpg",
  };
  secondDan.beatmaps[0] = {
    ...secondDan.beatmaps[0],
    title: "test stage three",
    artist: "osu!dojo",
    difficultyName: "ScoreV1",
    mapper: "staff",
    coverUrl: "https://assets.ppy.sh/beatmaps/4923775/covers/cover.jpg",
  };

  return systems;
}

test("seeded queries expose the sample dan and results", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = await listDanSystemsWithDans(db);
    const systemCourses = await listDanCoursesBySystemNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      db,
    );
    const course = await getDanCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const results = await listDanResultsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(systems.length, 1);
    assert.equal(systemCourses.length, 2);
    assert.equal(systems[0]?.dans[0]?.courseSlug, SEEDED_COURSE_SLUG);
    assert.equal(systems[0]?.dans[0]?.scoreModel, "scorev2");
    assert.equal(systems[0]?.dans[1]?.courseSlug, SEEDED_SECOND_COURSE_SLUG);
    assert.equal(systems[0]?.dans[1]?.scoreModel, "scorev1");
    assert.equal(course?.beatmaps.length, 2);
    assert.equal(course?.scoreModel, "scorev2");
    assert.match(course?.danSystemDescription ?? "", /Sample dan system/i);
    assert.equal(results?.results.length, 0);
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
    const databaseBundle = await createTestDatabase(temp.url);
    await seedDatabase(
      databaseBundle.db,
      addSampleBeatmapMetadata(
        cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
      ),
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
    const course = await getDanCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
    );

    assert.match(homeHtml, /Browse dan systems/);
    assert.doesNotMatch(homeHtml, /Open system/);
    assert.match(systemsHtml, /test/i);
    assert.match(systemsHtml, /\/dan\/test/);
    assert.match(systemsHtml, /Each system groups related dan courses under one scoring model\./);
    assert.match(courseHtml, /test stage one/i);
    assert.match(courseHtml, /!dojo start test 1st/);
    assert.match(courseHtml, /Sample dan system for the MVP\./);
    assert.match(courseHtml, new RegExp(course?.beatmaps[0]?.difficultyName ?? ""));
    assert.match(courseHtml, /ScoreV2/);
    assert.match(courseHtml, /20\.00%\+/);
    assert.match(courseHtml, /10\.00%\+/);
    assert.match(courseHtml, /10,000\+ score/);
    assert.match(courseHtml, /No runs saved yet/);
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
    const course = await getDanCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

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

    const results = await listDanResultsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(results?.results[0]?.username, "DNFPlayer");
    assert.equal(results?.results[0]?.status, "dnf");

    process.env.DATABASE_URL = temp.url;
    globalThis.__osuDojoDatabaseBundle = undefined;

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

test("seedDatabase synchronizes updated seeded beatmaps on an existing SQLite file", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const originalCourse = await getDanCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
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

    const updatedCourse = await getDanCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const updatedResults = await listDanResultsByNameKey(
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
    assert.equal(updatedResults?.results.length, 0);
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
    );

    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
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

    const updatedCourse = await getDanCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

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
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
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

    const updatedCourse = await getDanCourseByNameKey(
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

    const updatedCourse = await getDanCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

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
