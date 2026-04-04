import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import {
  getDanCourseBySlug,
  listDanResultsBySlug,
  listDanSystemsWithDans,
  storeDanRunResult,
} from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import HomePage from "@/app/page";
import DanDetailPage from "@/app/dan/[slug]/page";
import DanResultsPage from "@/app/dan/[slug]/results/page";

function createTempDatabaseUrl() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "osudojo-"));
  return {
    url: `file:${path.join(directory, "dojo.sqlite")}`,
    cleanup() {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

test("seeded queries expose the sample dan and results", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = await listDanSystemsWithDans(db);
    const course = await getDanCourseBySlug("test-1dan", db);
    const results = await listDanResultsBySlug("test-1dan", db);

    assert.equal(systems.length, 1);
    assert.equal(systems[0]?.dans[0]?.slug, "test-1dan");
    assert.equal(course?.beatmaps.length, 2);
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
    const detailHtml = renderToStaticMarkup(
      await DanDetailPage({
        params: Promise.resolve({ slug: "test-1dan" }),
      }),
    );
    const resultsHtml = renderToStaticMarkup(
      await DanResultsPage({
        params: Promise.resolve({ slug: "test-1dan" }),
      }),
    );
    const course = await getDanCourseBySlug("test-1dan");

    assert.match(homeHtml, /test-1/i);
    assert.match(detailHtml, new RegExp(`Beatmap ${course?.beatmaps[0]?.beatmapId}`));
    assert.match(resultsHtml, /DemoPlayer/);
    assert.match(resultsHtml, /PASS/);
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
    const course = await getDanCourseBySlug("test-1dan", db);

    assert.ok(course);

    await storeDanRunResult(
      {
        userId: 777,
        username: "DNFPlayer",
        danId: course!.id,
        passed: false,
        startedAt: 1_800_000_000_000,
        completedAt: 1_800_000_010_000,
        maps: [
          {
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

    const results = await listDanResultsBySlug("test-1dan", db);
    assert.equal(results?.results[0]?.username, "DNFPlayer");
    assert.equal(results?.results[0]?.status, "dnf");

    process.env.DATABASE_URL = temp.url;
    globalThis.__osuDojoDatabaseBundle = undefined;

    const resultsHtml = renderToStaticMarkup(
      await DanResultsPage({
        params: Promise.resolve({ slug: "test-1dan" }),
      }),
    );

    assert.match(resultsHtml, /DNFPlayer/);
    assert.match(resultsHtml, /DNF/);
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
    const originalCourse = await getDanCourseBySlug("test-1dan", db);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const dan = systems[0]?.dans.find((entry) => entry.slug === "test-1dan");

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
    });

    await seedDatabase(db, systems);

    const updatedCourse = await getDanCourseBySlug("test-1dan", db);
    const updatedResults = await listDanResultsBySlug("test-1dan", db);

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
