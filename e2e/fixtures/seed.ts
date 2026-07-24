import path from "node:path";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import {
  getCourseByNameKey,
  storeCourseRunResult,
  updatePinnedClear,
} from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import {
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
  addSampleBeatmapMetadata,
} from "../../tests/helpers/dbFixtures";
import { dnfRun, passRun } from "../../tests/helpers/runFixtures";

const COURSE_DATA_DIR = path.join(process.cwd(), "data/courses");
const E2E_LIMIT_SYSTEM_NAME_KEY = "e2e-pins";

export async function seedE2eDatabase(url: string) {
  const bundle = await createTestDatabase(url);
  const now = Date.now();

  try {
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(COURSE_DATA_DIR)),
    );
    await seedDatabase(bundle.db, systems, { suppressMissingObjectCountWarnings: true });
    addE2eLimitCourses(bundle.db.$client);

    const firstCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      bundle.db,
    );
    const secondCourse = await getCourseByNameKey(SEEDED_SYSTEM_NAME_KEY, "2nd", bundle.db);
    const failOnlyCourse = await getCourseByNameKey(
      E2E_LIMIT_SYSTEM_NAME_KEY,
      "Fail only",
      bundle.db,
    );
    const crowdedCourse = await getCourseByNameKey(
      E2E_LIMIT_SYSTEM_NAME_KEY,
      "Crowded",
      bundle.db,
    );
    const historyCourse = await getCourseByNameKey(
      E2E_LIMIT_SYSTEM_NAME_KEY,
      "History",
      bundle.db,
    );

    if (!firstCourse || !secondCourse || !failOnlyCourse || !crowdedCourse || !historyCourse) {
      throw new Error("Missing canonical seeded e2e courses.");
    }

    bundle.sqlite
      .prepare(
        `INSERT INTO homepage_featured_courses (course_id, position)
         VALUES (?, ?)`,
      )
      .run(firstCourse.id, 1);
    await storeCourseRunResult(
      passRun(
        451,
        "NotableE2E",
        firstCourse,
        now - 2 * 60 * 60 * 1000,
      ),
      bundle.db,
    );

    bundle.sqlite
      .prepare(
        `INSERT INTO users (osu_user_id, username, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(88, "UsersOnly88", 1_799_999_000_000, 1_799_999_000_000);

    const olderFirst = await storeCourseRunResult(
      passRun(77, "E2EPlayer", firstCourse, now - 4 * 60 * 60 * 1000),
      bundle.db,
    );
    await storeCourseRunResult(
      passRun(77, "E2EPlayer", firstCourse, now - 3 * 60 * 60 * 1000),
      bundle.db,
    );
    await storeCourseRunResult(
      passRun(77, "E2EPlayer", secondCourse, 1_800_000_200_000),
      bundle.db,
    );

    const extraRuns = [];
    for (const [index, name] of ["3rd", "4th", "5th", "6th"].entries()) {
      const course = await getCourseByNameKey(
        E2E_LIMIT_SYSTEM_NAME_KEY,
        name,
        bundle.db,
      );
      if (!course) {
        throw new Error(`Missing e2e course ${name}.`);
      }
      extraRuns.push(
        await storeCourseRunResult(
          passRun(
            77,
            "E2EPlayer",
            course,
            1_800_000_300_000 + index * 100_000,
          ),
          bundle.db,
        ),
      );
    }

    await storeCourseRunResult(
      dnfRun(77, "E2EPlayer", failOnlyCourse, 1_800_000_700_000),
      bundle.db,
    );
    await storeCourseRunResult(
      passRun(77, "E2EPlayer", crowdedCourse, 1_800_000_800_000, {
        score: 500_000,
      }),
      bundle.db,
    );
    for (let index = 0; index < 10; index += 1) {
      await storeCourseRunResult(
        passRun(
          200 + index,
          `Crowded${index + 1}`,
          crowdedCourse,
          1_800_000_810_000 + index * 1_000,
          { score: 600_000 + index * 10_000 },
        ),
        bundle.db,
      );
    }
    await storeCourseRunResult(
      passRun(99, "OldName99", historyCourse, 1_800_000_600_000),
      bundle.db,
    );
    await storeCourseRunResult(
      passRun(99, "NewName99", historyCourse, 1_800_000_650_000),
      bundle.db,
    );

    await updatePinnedClear(
      77,
      { runId: olderFirst.run.id, pinned: true },
      bundle.db,
      1,
    );
    for (const [index, result] of extraRuns.slice(0, 3).entries()) {
      await updatePinnedClear(
        77,
        { runId: result.run.id, pinned: true },
        bundle.db,
        index + 2,
      );
    }

    bundle.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    bundle.sqlite.close();
  }
}

function addE2eLimitCourses(
  sqlite: Awaited<ReturnType<typeof createTestDatabase>>["sqlite"],
) {
  sqlite
    .prepare(
      `INSERT INTO dan_systems (
        id,
        name,
        slug,
        description,
        status,
        ladder,
        ladder_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "system-e2e-pins",
      "E2E Pins",
      E2E_LIMIT_SYSTEM_NAME_KEY,
      "E2E-only courses used to exercise the pinned-clear limit.",
      "draft",
      null,
      0,
    );

  const insertCourse = sqlite.prepare(`
    INSERT INTO courses (
      id,
      dan_system_id,
      creator_user_id,
      name,
      slug,
      description,
      tags,
      ordinal,
      official,
      label,
      score_model,
      overall_pass_conditions,
      created_at,
      updated_at
    )
    SELECT
      ?,
      'system-e2e-pins',
      creator_user_id,
      ?,
      ?,
      description,
      tags,
      ?,
      0,
      NULL,
      score_model,
      overall_pass_conditions,
      created_at,
      updated_at
    FROM courses
    WHERE id = 'course-test-1dan'
  `);
  const insertBeatmaps = sqlite.prepare(`
    INSERT INTO beatmaps (
      id,
      course_id,
      beatmap_id,
      mods,
      freemod,
      pass_conditions,
      ordinal,
      annotations
    )
    SELECT
      id || ?,
      ?,
      beatmap_id,
      mods,
      freemod,
      pass_conditions,
      ordinal,
      annotations
    FROM beatmaps
    WHERE course_id = 'course-test-1dan'
  `);

  for (const [index, name] of [
    "3rd",
    "4th",
    "5th",
    "6th",
    "Fail only",
    "Crowded",
    "History",
  ].entries()) {
    const courseId = `course-test-${name}`;
    insertCourse.run(courseId, name, courseId, index + 3);
    insertBeatmaps.run(`-${name}`, courseId);
  }
}
