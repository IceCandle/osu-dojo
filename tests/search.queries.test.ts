import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { courses, danSystems } from "@/db/schema";
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
