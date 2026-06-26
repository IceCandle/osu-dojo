import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { getCourseByNameKey } from "@/db/queries";
import { assessCoursePassability } from "@/lib/judging";
import type { CourseDefinition } from "@/lib/domain";
import { createTempDatabaseUrl } from "./helpers/tempDatabase";

test("assessCoursePassability returns passable for empty mapResults", () => {
  const result = assessCoursePassability(course(2), []);

  assert.deepEqual(result, { passable: true, reasons: [] });
});

test("assessCoursePassability stays passable when no proven failure exists", () => {
  const result = assessCoursePassability(course(2), [
    mapResult({ accuracy: 95, countMiss: 1, ordinal: 1, passed: true }),
  ]);

  assert.deepEqual(result, { passable: true, reasons: [] });
});

test("assessCoursePassability reports the latest failed map", () => {
  const result = assessCoursePassability(course(3), [
    mapResult({ ordinal: 1, passed: false }),
    mapResult({ ordinal: 2, passed: true }),
    mapResult({ ordinal: 3, passed: false }),
  ]);

  assert.deepEqual(result, {
    passable: false,
    reasons: [{ type: "mapFailed", mapOrdinal: 3 }],
  });
});

test("assessCoursePassability reports a single failed map", () => {
  const result = assessCoursePassability(course(2), [
    mapResult({ ordinal: 1, passed: false }),
  ]);

  assert.deepEqual(result, {
    passable: false,
    reasons: [{ type: "mapFailed", mapOrdinal: 1 }],
  });
});

test("assessCoursePassability keeps prior map failure cumulative", () => {
  const result = assessCoursePassability(course(2), [
    mapResult({ ordinal: 1, passed: false }),
    mapResult({ ordinal: 2, passed: true }),
  ]);

  assert.deepEqual(result, {
    passable: false,
    reasons: [{ type: "mapFailed", mapOrdinal: 1 }],
  });
});

test("assessCoursePassability reports totalMissCount only after exceeding threshold", () => {
  assert.equal(
    assessCoursePassability(course(2, [{ type: "totalMissCount", threshold: 3 }]), [
      mapResult({ countMiss: 3 }),
    ]).passable,
    true,
  );

  assert.deepEqual(
    assessCoursePassability(course(2, [{ type: "totalMissCount", threshold: 3 }]), [
      mapResult({ countMiss: 4 }),
    ]).reasons,
    [{ type: "totalMissCountExceeded", value: 4, threshold: 3 }],
  );
});

test("assessCoursePassability reports unreachable courseAccuracy only when proven", () => {
  assert.equal(
    assessCoursePassability(course(3, [{ type: "courseAccuracy", threshold: 280 }]), [
      mapResult({ accuracy: 80, passed: true }),
    ]).passable,
    true,
  );

  assert.deepEqual(
    assessCoursePassability(course(3, [{ type: "courseAccuracy", threshold: 281 }]), [
      mapResult({ accuracy: 80, passed: true }),
    ]).reasons,
    [{ type: "courseAccuracyUnreachable", threshold: 281, bestPossible: 280 }],
  );
});

test("assessCoursePassability derives courseAccuracy reachability from remaining map count", () => {
  const result = assessCoursePassability(
    course(2, [{ type: "courseAccuracy", threshold: 280 }]),
    [mapResult({ accuracy: 80, passed: true })],
  );

  assert.deepEqual(result.reasons, [
    { type: "courseAccuracyUnreachable", threshold: 280, bestPossible: 180 },
  ]);
});

test("assessCoursePassability excludes failed map accuracy from courseAccuracy reachability", () => {
  const result = assessCoursePassability(
    course(3, [{ type: "courseAccuracy", threshold: 190 }]),
    [
      mapResult({ accuracy: 99, ordinal: 1, passed: false }),
      mapResult({ accuracy: 89, ordinal: 2, passed: true }),
    ],
  );

  assert.deepEqual(result.reasons, [
    { type: "mapFailed", mapOrdinal: 1 },
    { type: "courseAccuracyUnreachable", threshold: 190, bestPossible: 189 },
  ]);
});

test("assessCoursePassability ignores totalScore impossibility", () => {
  const result = assessCoursePassability(
    course(2, [{ type: "totalScore", threshold: 2_000_000 }]),
    [mapResult({ passed: true })],
  );

  assert.deepEqual(result, { passable: true, reasons: [] });
});

test("assessCoursePassability stacks reasons in declared order", () => {
  const result = assessCoursePassability(
    course(2, [
      { type: "totalScore", threshold: 2_000_000 },
      { type: "totalMissCount", threshold: 1 },
      { type: "courseAccuracy", threshold: 190 },
    ]),
    [mapResult({ accuracy: 80, countMiss: 2, ordinal: 1, passed: false })],
  );

  assert.deepEqual(result.reasons, [
    { type: "mapFailed", mapOrdinal: 1 },
    { type: "totalMissCountExceeded", value: 2, threshold: 1 },
    { type: "courseAccuracyUnreachable", threshold: 190, bestPossible: 100 },
  ]);
});

test("course condition parse errors include the course slug", async () => {
  const temp = createTempDatabaseUrl("osudojo-conditions-");

  try {
    const { db } = await createTestDatabase(temp.url);
    db.$client
      .prepare("UPDATE courses SET overall_pass_conditions = ? WHERE slug = ?")
      .run("[", "test-1dan");

    await assert.rejects(
      getCourseByNameKey("test", "1st", db),
      /course pass conditions for course "test-1dan" contains invalid JSON/,
    );
  } finally {
    temp.cleanup();
  }
});

function course(
  mapCount: number,
  overallPassConditions: CourseDefinition["overallPassConditions"] = [],
): CourseDefinition {
  return {
    id: "course",
    danSystemId: "system",
    danSystemName: "Test",
    danSystemSlug: "test",
    danSystemDescription: "Test",
    danSystemStatus: "current",
    danSystemLadder: null,
    danSystemLadderOrder: 0,
    name: "1st",
    slug: "1st",
    description: "Test course",
    tags: [],
    ordinal: 1,
    official: false,
    label: null,
    scoreModel: "scorev2",
    overallPassConditions,
    beatmaps: Array.from({ length: mapCount }, (_, index) => ({
      id: `beatmap-${index + 1}`,
      beatmapId: 1000 + index,
      mods: "NM",
      freemod: false,
      passConditions: [],
      ordinal: index + 1,
      title: "Title",
      artist: "Artist",
      difficultyName: "Diff",
      mapper: "Mapper",
      coverUrl: "",
      totalObjects: null,
      annotations: [],
    })),
  };
}

function mapResult(
  overrides: Partial<{
    accuracy: number;
    countMiss: number;
    ordinal: number;
    passed: boolean;
  }> = {},
) {
  return {
    accuracy: overrides.accuracy ?? 100,
    countMiss: overrides.countMiss ?? 0,
    ordinal: overrides.ordinal ?? 1,
    passed: overrides.passed ?? true,
  };
}
