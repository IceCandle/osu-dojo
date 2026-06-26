import path from "node:path";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import { getCourseByNameKey, storeCourseRunResult } from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import {
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
  addSampleBeatmapMetadata,
} from "../../tests/helpers/dbFixtures";
import { passRun } from "../../tests/helpers/runFixtures";

const COURSE_DATA_DIR = path.join(process.cwd(), "data/courses");

export async function seedE2eDatabase(url: string) {
  const bundle = await createTestDatabase(url);

  try {
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(COURSE_DATA_DIR)),
    );
    await seedDatabase(bundle.db, systems, { suppressMissingObjectCountWarnings: true });

    const firstCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      bundle.db,
    );
    const secondCourse = await getCourseByNameKey(SEEDED_SYSTEM_NAME_KEY, "2nd", bundle.db);

    if (!firstCourse || !secondCourse) {
      throw new Error("Missing canonical seeded e2e courses.");
    }

    await storeCourseRunResult(
      passRun(77, "E2EPlayer", firstCourse, 1_800_000_000_000),
      bundle.db,
    );
    await storeCourseRunResult(
      passRun(77, "E2EPlayer", secondCourse, 1_800_000_200_000),
      bundle.db,
    );

    bundle.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    bundle.sqlite.close();
  }
}
