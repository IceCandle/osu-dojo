import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "@/db/client";
import {
  assertCourseColumnsPreserved,
  createLegacyCoursesDatabase,
  readCourseRows,
  type LegacyCourseRow,
} from "./helpers/legacyDatabase";
import { createTempDatabaseUrl } from "./helpers/tempDatabase";

const legacyRows: LegacyCourseRow[] = [
  {
    id: "legacy-official-course",
    danSystemId: "legacy-system",
    creatorUserId: null,
    name: "Legacy Official",
    slug: "legacy-official",
    description: "Official migration fixture",
    tags: JSON.stringify(["legacy", "official"]),
    ordinal: 1,
    official: 1,
    label: "1st",
    scoreModel: "scorev2",
    overallPassType: null,
    overallPassThreshold: null,
    overallPassConditions: "[]",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
  },
  {
    id: "legacy-user-course",
    danSystemId: "legacy-system",
    creatorUserId: 53,
    name: "Legacy User Course",
    slug: "legacy-user-course",
    description: "User-created migration fixture",
    tags: JSON.stringify(["legacy", "user-created"]),
    ordinal: 2,
    official: 0,
    label: null,
    scoreModel: "scorev2",
    overallPassType: null,
    overallPassThreshold: null,
    overallPassConditions: "[]",
    createdAt: 1_700_000_200_000,
    updatedAt: 1_700_000_300_000,
  },
];

test("courses rebuild preserves every non-retired column", async () => {
  const temp = createTempDatabaseUrl("osudojo-course-migration-");
  let migratedSqlite: Awaited<ReturnType<typeof createTestDatabase>>["sqlite"] | undefined;

  try {
    const legacySqlite = createLegacyCoursesDatabase(temp.url, legacyRows);
    const ids = legacyRows.map((row) => row.id);
    const before = readCourseRows(legacySqlite, ids);
    legacySqlite.close();

    const databaseBundle = await createTestDatabase(temp.url);
    migratedSqlite = databaseBundle.sqlite;
    const after = readCourseRows(migratedSqlite, ids);

    assert.equal(after["legacy-official-course"]?.["official"], 1);
    assert.equal(after["legacy-official-course"]?.["label"], "1st");
    assert.equal(after["legacy-user-course"]?.["official"], 0);
    assert.equal(after["legacy-user-course"]?.["label"], null);
    assertCourseColumnsPreserved(before, after, {
      retiredColumns: ["overall_pass_type", "overall_pass_threshold"],
    });
  } finally {
    migratedSqlite?.close();
    temp.cleanup();
  }
});
