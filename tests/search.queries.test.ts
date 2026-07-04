import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { courses, danSystems, runs, users } from "@/db/schema";
import { searchDanCatalog } from "@/db/queries";
import { createTempDatabaseUrl } from "./helpers/dbFixtures";

test("searchDanCatalog matches current and legacy systems and courses by display name", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await db.insert(danSystems).values({
      id: "system-legacy-alpha",
      name: "Legacy Alpha",
      slug: "legacy-alpha-internal",
      description: "Legacy search fixture.",
      status: "legacy",
    });
    await db.insert(courses).values({
      id: "course-legacy-alpha-pro",
      danSystemId: "system-legacy-alpha",
      name: "Alpha Pro",
      slug: "legacy-alpha-pro-internal",
      description: "Legacy course search fixture.",
      ordinal: 1,
      scoreModel: "scorev2",
      overallPassConditions: "[]",
    });

    const systemResults = await searchDanCatalog("  LEGACY   alpha ", db);
    const courseResults = await searchDanCatalog("alpha pro", db);

    assert.deepEqual(systemResults.systems, [
      { name: "Legacy Alpha", nameKey: "legacy-alpha", status: "legacy" },
    ]);
    assert.deepEqual(systemResults.players, []);
    assert.deepEqual(courseResults.courses, [
      {
        name: "Alpha Pro",
        nameKey: "alpha-pro",
        systemName: "Legacy Alpha",
        systemNameKey: "legacy-alpha",
      },
    ]);
    assert.deepEqual(courseResults.players, []);
  } finally {
    temp.cleanup();
  }
});

test("searchDanCatalog excludes draft and archived systems and their courses", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await db.insert(danSystems).values([
      {
        id: "system-hidden-draft",
        name: "Hidden Draft",
        slug: "hidden-draft",
        description: "Hidden draft fixture.",
        status: "draft",
      },
      {
        id: "system-hidden-archived",
        name: "Hidden Archived",
        slug: "hidden-archived",
        description: "Hidden archived fixture.",
        status: "archived",
      },
    ]);
    await db.insert(courses).values([
      {
        id: "course-hidden-draft",
        danSystemId: "system-hidden-draft",
        name: "Hidden Course",
        slug: "hidden-draft-course",
        description: "Hidden draft course fixture.",
        ordinal: 1,
        scoreModel: "scorev2",
        overallPassConditions: "[]",
      },
      {
        id: "course-hidden-archived",
        danSystemId: "system-hidden-archived",
        name: "Hidden Course",
        slug: "hidden-archived-course",
        description: "Hidden archived course fixture.",
        ordinal: 1,
        scoreModel: "scorev2",
        overallPassConditions: "[]",
      },
    ]);

    const results = await searchDanCatalog("hidden", db);

    assert.deepEqual(results, { systems: [], courses: [], players: [] });
  } finally {
    temp.cleanup();
  }
});

test("searchDanCatalog caps ordered results", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systemRows = Array.from({ length: 12 }, (_, index) => ({
      id: `system-cap-${String(index).padStart(2, "0")}`,
      name: `Cap ${String(index).padStart(2, "0")}`,
      slug: `cap-${String(index).padStart(2, "0")}`,
      description: "Cap fixture.",
      status: "current" as const,
    }));
    await db.insert(danSystems).values(systemRows);
    await db.insert(courses).values(
      systemRows.flatMap((system, systemIndex) =>
        Array.from({ length: 2 }, (_, courseIndex) => ({
          id: `course-${system.id}-${courseIndex}`,
          danSystemId: system.id,
          name: `Cap Course ${String(systemIndex).padStart(2, "0")}-${courseIndex}`,
          slug: `cap-course-${systemIndex}-${courseIndex}`,
          description: "Cap course fixture.",
          ordinal: courseIndex + 1,
          scoreModel: "scorev2" as const,
          overallPassConditions: "[]",
        })),
      ),
    );

    const results = await searchDanCatalog("cap", db);

    assert.equal(results.systems.length, 10);
    assert.equal(results.courses.length, 20);
    assert.equal(results.systems[0]?.name, "Cap 00");
    assert.equal(results.systems[9]?.name, "Cap 09");
    assert.equal(results.courses[0]?.name, "Cap Course 00-0");
    assert.equal(results.courses[19]?.name, "Cap Course 09-1");
  } finally {
    temp.cleanup();
  }
});

test("searchDanCatalog applies official filter only to catalog hits", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await db.insert(danSystems).values([
      catalogSystem("system-main-alpha", "Main Alpha", "current", "main-dan"),
      catalogSystem("system-main-beta", "Main Beta", "current", "main-dan"),
      catalogSystem("system-alt-alpha", "Alt Alpha", "legacy", "alt-dan"),
      catalogSystem("system-draft-alpha", "Draft Alpha", "draft", "main-dan"),
      catalogSystem("system-archived-alpha", "Archived Alpha", "archived", "main-dan"),
    ]);
    await db.insert(courses).values([
      catalogCourse("course-main-alpha-official", "system-main-alpha", "Alpha Official", 1, true),
      catalogCourse("course-main-alpha-community", "system-main-alpha", "Alpha Community", 2, false),
      catalogCourse("course-main-beta-community", "system-main-beta", "Alpha Beta Community", 1, false),
      catalogCourse("course-alt-alpha-official", "system-alt-alpha", "Alpha Alt Official", 1, true),
      catalogCourse("course-draft-alpha-official", "system-draft-alpha", "Alpha Draft Official", 1, true),
      catalogCourse("course-archived-alpha-official", "system-archived-alpha", "Alpha Archived Official", 1, true),
    ]);
    await db.insert(runs).values({
      id: "run-alpha-player",
      userId: 9001,
      username: "AlphaPlayer",
      courseId: "course-main-alpha-community",
      passed: true,
      startedAt: 1_800_000_000_000,
      completedAt: 1_800_000_060_000,
      matchId: null,
    });
    await db.insert(users).values({
      osuUserId: 9001,
      username: "AlphaPlayer",
      createdAt: 1_800_000_060_000,
      updatedAt: 1_800_000_060_000,
    });

    const officialResults = await searchDanCatalog(
      "alpha",
      { officialOnly: true },
      db,
    );

    assert.deepEqual(
      officialResults.systems.map((system) => system.name),
      ["Alt Alpha", "Main Alpha"],
    );
    assert.deepEqual(
      officialResults.courses.map((course) => course.name),
      ["Alpha Alt Official", "Alpha Official"],
    );
    assert.equal(officialResults.players[0]?.username, "AlphaPlayer");
  } finally {
    temp.cleanup();
  }
});

function catalogSystem(
  id: string,
  name: string,
  status: "current" | "legacy" | "draft" | "archived",
  ladder: string | null,
) {
  return {
    id,
    name,
    slug: `${id}-slug`,
    description: `${name} fixture.`,
    status,
    ladder,
    ladderOrder: 0,
  };
}

function catalogCourse(
  id: string,
  danSystemId: string,
  name: string,
  ordinal: number,
  official: boolean,
) {
  return {
    id,
    danSystemId,
    name,
    slug: `${id}-slug`,
    description: `${name} fixture.`,
    ordinal,
    official,
    scoreModel: "scorev2" as const,
    overallPassConditions: "[]",
  };
}
