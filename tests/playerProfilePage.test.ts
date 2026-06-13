import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { getCourseByNameKey, storeCourseRunResult } from "@/db/queries";
import PlayerProfilePage from "@/app/players/[userId]/page";
import type { CourseDefinition } from "@/lib/domain";
import {
  createTempDatabaseUrl,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";

test("player profile page renders saved local runs", async () => {
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

    await storeCourseRunResult(passRun(77, "PagePlayer", course, 1_800_000_000_000), databaseBundle.db);

    const html = renderToStaticMarkup(
      await PlayerProfilePage({
        params: Promise.resolve({ userId: "77" }),
        searchParams: Promise.resolve({ mode: "osu" }),
      }),
    );

    assert.match(html, /PagePlayer/);
    assert.match(html, /https:\/\/osu\.ppy\.sh\/users\/77/);
    assert.match(html, /Highest official dan/);
    assert.match(html, /Pinned clears/);
    assert.match(html, /Recent runs/);
    assert.match(html, /Most played courses/);
    assert.match(html, /aria-selected="true"[^>]*>osu/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("player profile page renders safe empty state for numeric no-runs users", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = await createTestDatabase(temp.url);

    const html = renderToStaticMarkup(
      await PlayerProfilePage({
        params: Promise.resolve({ userId: "888888" }),
        searchParams: Promise.resolve({}),
      }),
    );

    assert.match(html, /User 888888/);
    assert.match(html, /No saved runs/);
    assert.doesNotMatch(html, /undefined/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("player profile page rejects non-numeric user ids", async () => {
  await assert.rejects(
    () =>
      PlayerProfilePage({
        params: Promise.resolve({ userId: "not-a-user" }),
        searchParams: Promise.resolve({}),
      }),
    (error) =>
      error instanceof Error &&
      (error.message === "NEXT_NOT_FOUND" ||
        ("digest" in error &&
          String(error.digest).includes("NEXT_HTTP_ERROR_FALLBACK;404"))),
  );
});

function passRun(
  userId: number,
  username: string,
  course: CourseDefinition,
  completedAt: number,
) {
  return {
    userId,
    username,
    courseId: course.id,
    passed: true,
    startedAt: completedAt - 60_000,
    completedAt,
    matchId: null,
    maps: course.beatmaps.map((beatmap, index) => ({
      gameId: completedAt + index,
      beatmapId: beatmap.beatmapId,
      mods: beatmap.mods,
      passConditions: beatmap.passConditions,
      ordinal: beatmap.ordinal,
      score: 1_000_000 - index,
      rawScore: 1_000_000 - index,
      playedMods: beatmap.mods,
      accuracy: 99 - index,
      maxCombo: 1_000,
      count300: 1_000,
      count100: 0,
      count50: 0,
      countMiss: 0,
      passed: true,
      createdAt: completedAt + index,
    })),
  };
}
