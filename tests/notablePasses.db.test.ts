import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "@/db/client";
import {
  getCourseByNameKey,
  listNotablePasses,
  storeCourseRunResult,
} from "@/db/queries";
import {
  NOTABLE_PASS_LIMIT,
  NOTABLE_PASS_WINDOW_MS,
} from "@/lib/notablePasses";
import { createTempDatabaseUrl } from "./helpers/tempDatabase";
import { dnfRun, passRun } from "./helpers/runFixtures";

const NOW = 2_000_000_000_000;

test("listNotablePasses includes the 30-day boundary and excludes older passes", async () => {
  await withNotablePassDatabase(async ({ db, sqlite, featuredCourse }) => {
    featureCourse(sqlite, featuredCourse.id);
    const boundary = await storeCourseRunResult(
      passRun(101, "BoundaryPlayer", featuredCourse, NOW - NOTABLE_PASS_WINDOW_MS),
      db,
    );
    await storeCourseRunResult(
      passRun(102, "TooOldPlayer", featuredCourse, NOW - NOTABLE_PASS_WINDOW_MS - 1),
      db,
    );

    const passes = await listNotablePasses(NOW, db);

    assert.deepEqual(passes.map((pass) => pass.runId), [boundary.run.id]);
  });
});

test("listNotablePasses deduplicates, sorts ties by run id, and limits results", async () => {
  await withNotablePassDatabase(async ({ db, sqlite, featuredCourse }) => {
    featureCourse(sqlite, featuredCourse.id);
    await storeCourseRunResult(
      passRun(201, "RepeatPlayer", featuredCourse, NOW - 10_000),
      db,
    );
    const repeatLatest = await storeCourseRunResult(
      passRun(201, "RepeatPlayer", featuredCourse, NOW - 100),
      db,
    );
    const tied = await storeCourseRunResult(
      passRun(202, "TiedPlayer", featuredCourse, NOW - 100),
      db,
    );
    const third = await storeCourseRunResult(
      passRun(203, "ThirdPlayer", featuredCourse, NOW - 200),
      db,
    );
    await storeCourseRunResult(
      passRun(204, "FourthPlayer", featuredCourse, NOW - 300),
      db,
    );
    await storeCourseRunResult(
      passRun(205, "FifthPlayer", featuredCourse, NOW - 400),
      db,
    );

    const passes = await listNotablePasses(NOW, db);
    const tiedRunIds = [repeatLatest.run.id, tied.run.id].sort().reverse();

    assert.equal(passes.length, NOTABLE_PASS_LIMIT);
    assert.deepEqual(
      passes.map((pass) => pass.runId),
      [...tiedRunIds, third.run.id],
    );
    assert.equal(
      passes.filter((pass) => pass.userId === 201 && pass.courseId === featuredCourse.id).length,
      1,
    );
  });
});

test("listNotablePasses requires passed, featured, and official courses", async () => {
  await withNotablePassDatabase(
    async ({ db, sqlite, featuredCourse, unofficialCourse }) => {
      featureCourse(sqlite, featuredCourse.id);
      featureCourse(sqlite, unofficialCourse.id, 2);

      const eligible = await storeCourseRunResult(
        passRun(301, "EligiblePlayer", featuredCourse, NOW - 1_000),
        db,
      );
      await storeCourseRunResult(
        dnfRun(302, "FailedPlayer", featuredCourse, NOW - 500),
        db,
      );
      await storeCourseRunResult(
        passRun(303, "UnofficialPlayer", unofficialCourse, NOW - 250),
        db,
      );

      sqlite.prepare("DELETE FROM homepage_featured_courses WHERE course_id = ?").run(
        featuredCourse.id,
      );
      assert.deepEqual(await listNotablePasses(NOW, db), []);

      featureCourse(sqlite, featuredCourse.id);
      const passes = await listNotablePasses(NOW, db);
      assert.deepEqual(passes.map((pass) => pass.runId), [eligible.run.id]);
    },
  );
});

test("listNotablePasses returns an empty list without featured courses", async () => {
  await withNotablePassDatabase(async ({ db, featuredCourse }) => {
    await storeCourseRunResult(
      passRun(401, "UnfeaturedPlayer", featuredCourse, NOW - 1_000),
      db,
    );

    assert.deepEqual(await listNotablePasses(NOW, db), []);
  });
});

async function withNotablePassDatabase(
  run: (context: {
    db: Awaited<ReturnType<typeof createTestDatabase>>["db"];
    sqlite: Awaited<ReturnType<typeof createTestDatabase>>["sqlite"];
    featuredCourse: NonNullable<Awaited<ReturnType<typeof getCourseByNameKey>>>;
    unofficialCourse: NonNullable<Awaited<ReturnType<typeof getCourseByNameKey>>>;
  }) => Promise<void>,
) {
  const temp = createTempDatabaseUrl("osudojo-notable-passes-");
  const bundle = await createTestDatabase(temp.url);

  try {
    const featuredCourse = await getCourseByNameKey("test", "1st", bundle.db);
    const unofficialCourse = await getCourseByNameKey("test", "2nd", bundle.db);
    assert.ok(featuredCourse);
    assert.ok(unofficialCourse);

    await run({
      db: bundle.db,
      sqlite: bundle.sqlite,
      featuredCourse,
      unofficialCourse,
    });
  } finally {
    bundle.sqlite.close();
    temp.cleanup();
  }
}

function featureCourse(
  sqlite: Awaited<ReturnType<typeof createTestDatabase>>["sqlite"],
  courseId: string,
  position = 1,
) {
  sqlite
    .prepare(
      `INSERT INTO homepage_featured_courses (course_id, position)
       VALUES (?, ?)`,
    )
    .run(courseId, position);
}
