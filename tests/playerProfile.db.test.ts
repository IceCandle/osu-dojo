import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import { getCourseByNameKey, getPlayerProfile, storeCourseRunResult } from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import type { CourseDefinition } from "@/lib/domain";
import {
  createTempDatabaseUrl,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";

test("getPlayerProfile aggregates local runs and returns null for no-runs users", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const firstCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const secondCourse = await getCourseByNameKey(SEEDED_SYSTEM_NAME_KEY, "2nd", db);

    assert.ok(firstCourse);
    assert.ok(secondCourse);

    await storeCourseRunResult(passRun(44, "PlayerOld", firstCourse, 1_800_000_000_000), db);
    await storeCourseRunResult(passRun(44, "PlayerNew", firstCourse, 1_800_000_100_000), db);
    await storeCourseRunResult(passRun(44, "PlayerNew", secondCourse, 1_800_000_200_000), db);
    await storeCourseRunResult(dnfRun(44, "PlayerNew", firstCourse, 1_800_000_300_000), db);

    const profile = await getPlayerProfile(44, db);

    assert.equal(await getPlayerProfile(999_999, db), null);
    assert.ok(profile);
    assert.equal(profile.username, "PlayerNew");
    assert.equal(profile.playCount, 4);
    assert.deepEqual(
      profile.highestOfficialDans.map((badge) => badge.label),
      ["1st"],
    );
    assert.equal(profile.pinnedClears.length, 2);
    assert.equal(profile.pinnedClears[0]?.courseName, "1st");
    assert.equal(profile.pinnedClears[1]?.courseName, "2nd");
    assert.equal(profile.recentRuns[0]?.status, "dnf");
    assert.equal(profile.mostPlayedCourses[0]?.courseName, "1st");
    assert.equal(profile.mostPlayedCourses[0]?.playCount, 3);
  } finally {
    temp.cleanup();
  }
});

test("getPlayerProfile merges official badges across systems sharing a ladder", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const baseSystem = systems[0]!;
    const baseCourse = baseSystem.courses[0]!;
    const makeSystem = (
      id: string,
      name: string,
      ladderOrder: number,
      courseName: string,
      courseOrdinal: number,
      label: string,
    ) => ({
      ...baseSystem,
      id,
      name,
      slug: id,
      ladder: "main-dan",
      ladderOrder,
      courses: [
        {
          ...baseCourse,
          id: `${id}-course`,
          name: courseName,
          slug: `${id}-course`,
          ordinal: courseOrdinal,
          official: true,
          label,
          beatmaps: baseCourse.beatmaps.map((beatmap) => ({
            ...beatmap,
            id: `${id}-${beatmap.id}`,
          })),
        },
      ],
    });

    await seedDatabase(
      db,
      [
        makeSystem("kyu-test", "Kyu Test", 0, "10th", 10, "K10"),
        makeSystem("dan-test", "Dan Test", 1, "1st", 1, "D1"),
      ],
      { suppressMissingObjectCountWarnings: true },
    );

    const kyuCourse = await getCourseByNameKey("kyu-test", "10th", db);
    const danCourse = await getCourseByNameKey("dan-test", "1st", db);
    assert.ok(kyuCourse);
    assert.ok(danCourse);

    await storeCourseRunResult(passRun(55, "LadderPlayer", kyuCourse, 1_800_000_000_000), db);
    await storeCourseRunResult(passRun(55, "LadderPlayer", danCourse, 1_800_000_100_000), db);

    const profile = await getPlayerProfile(55, db);

    assert.ok(profile);
    assert.deepEqual(
      profile.highestOfficialDans.map((badge) => badge.label),
      ["D1"],
    );
  } finally {
    temp.cleanup();
  }
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

function dnfRun(
  userId: number,
  username: string,
  course: CourseDefinition,
  completedAt: number,
) {
  const beatmap = course.beatmaps[0]!;
  return {
    userId,
    username,
    courseId: course.id,
    passed: false,
    startedAt: completedAt - 60_000,
    completedAt,
    matchId: null,
    maps: [
      {
        gameId: completedAt,
        beatmapId: beatmap.beatmapId,
        mods: beatmap.mods,
        passConditions: beatmap.passConditions,
        ordinal: beatmap.ordinal,
        score: 100_000,
        rawScore: 100_000,
        playedMods: beatmap.mods,
        accuracy: 80,
        maxCombo: 100,
        count300: 800,
        count100: 100,
        count50: 50,
        countMiss: 10,
        passed: true,
        createdAt: completedAt,
      },
    ],
  };
}
