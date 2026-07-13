import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import { getCourseByNameKey, getPlayerProfile, storeCourseRunResult } from "@/db/queries";
import { users } from "@/db/schema";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import {
  createTempDatabaseUrl,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";
import { dnfRun, passRun } from "./helpers/runFixtures";

test("getPlayerProfile aggregates run-backed users and supports users-only profiles", async () => {
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

    const profile = await getPlayerProfile(44, { db });
    await db.insert(users).values({
      osuUserId: 45,
      username: "LoginOnly",
      createdAt: 1_800_000_400_000,
      updatedAt: 1_800_000_400_000,
    });
    const usersOnlyProfile = await getPlayerProfile(45, { db });

    assert.equal(await getPlayerProfile(999_999, { db }), null);
    assert.ok(usersOnlyProfile);
    assert.equal(usersOnlyProfile.username, "LoginOnly");
    assert.equal(usersOnlyProfile.detailsVisible, true);
    if (!usersOnlyProfile.detailsVisible) {
      assert.fail("Expected users-only profile details.");
    }
    assert.equal(usersOnlyProfile.playCount, 0);
    assert.deepEqual(usersOnlyProfile.highestOfficialDans, []);
    assert.deepEqual(usersOnlyProfile.pinnedClears, []);
    assert.deepEqual(usersOnlyProfile.recentRuns, []);
    assert.deepEqual(usersOnlyProfile.mostPlayedCourses, []);
    assert.ok(profile);
    assert.equal(profile.detailsVisible, true);
    if (!profile.detailsVisible) {
      assert.fail("Expected public profile details.");
    }
    assert.equal(profile.username, "PlayerNew");
    assert.equal(profile.playCount, 4);
    assert.deepEqual(
      profile.highestOfficialDans.map((badge) => badge.label),
      ["1st"],
    );
    assert.equal(profile.pinnedClears.length, 0);
    assert.equal(profile.recentRuns[0]?.status, "dnf");
    assert.equal(profile.mostPlayedCourses[0]?.courseName, "1st");
    assert.equal(profile.mostPlayedCourses[0]?.playCount, 3);
  } finally {
    temp.cleanup();
  }
});

test("storeCourseRunResult timestamp-guards users and rolls identity back with run writes", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.ok(course);

    await storeCourseRunResult(passRun(66, "CurrentName", course, 1_800_000_200_000), db);
    await storeCourseRunResult(passRun(66, "OlderName", course, 1_800_000_100_000), db);
    assert.deepEqual(
      db.$client
        .prepare(
          "SELECT username, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE osu_user_id = ?",
        )
        .get(66),
      {
        username: "CurrentName",
        createdAt: 1_800_000_200_000,
        updatedAt: 1_800_000_200_000,
      },
    );

    db.$client.exec(`
      CREATE TRIGGER reject_map_result
      BEFORE INSERT ON map_results
      BEGIN
        SELECT RAISE(ABORT, 'map write rejected');
      END;
    `);
    await assert.rejects(
      () =>
        storeCourseRunResult(
          passRun(67, "RolledBackName", course, 1_800_000_300_000),
          db,
        ),
      /map write rejected/,
    );
    assert.deepEqual(
      db.$client
        .prepare("SELECT COUNT(*) AS count FROM users WHERE osu_user_id = 67")
        .get(),
      { count: 0 },
    );
    assert.deepEqual(
      db.$client
        .prepare("SELECT COUNT(*) AS count FROM runs WHERE user_id = 67")
        .get(),
      { count: 0 },
    );
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

    const profile = await getPlayerProfile(55, { db });

    assert.ok(profile);
    assert.deepEqual(
      profile.highestOfficialDans.map((badge) => badge.label),
      ["D1"],
    );
  } finally {
    temp.cleanup();
  }
});
