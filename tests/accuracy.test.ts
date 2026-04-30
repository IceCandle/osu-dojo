import test from "node:test";
import assert from "node:assert/strict";
import { calculateAccuracy } from "@/lib/accuracy";
import {
  evaluateCourseConditions,
  evaluateMapConditions,
  judgeCourseRun,
  judgeThreshold,
} from "@/lib/judging";
import type { CourseDefinition, JudgedMapResult } from "@/lib/domain";

test("calculateAccuracy uses osu stable standard hit windows only", () => {
  const accuracy = calculateAccuracy({
    count300: 900,
    count100: 90,
    count50: 10,
    countMiss: 5,
  });

  assert.equal(accuracy?.toFixed(4), "92.7032");
});

test("calculateAccuracy returns 0 when there are no hits to score", () => {
  const accuracy = calculateAccuracy({
    count300: 0,
    count100: 0,
    count50: 0,
    countMiss: 0,
  });

  assert.equal(accuracy, 0);
});

test("calculateAccuracy returns 0 for an all-miss score", () => {
  const accuracy = calculateAccuracy({
    count300: 0,
    count100: 0,
    count50: 0,
    countMiss: 100,
  });

  assert.equal(accuracy, 0);
});

test("calculateAccuracy returns 100 for a perfect all-300 score", () => {
  const accuracy = calculateAccuracy({
    count300: 100,
    count100: 0,
    count50: 0,
    countMiss: 0,
  });

  assert.equal(accuracy, 100);
});

test("judgeThreshold supports lower and upper bound comparisons", () => {
  const accuracy = judgeThreshold("accuracy", 95, 96.25);
  const misses = judgeThreshold("missCount", 3, 2, "<=");

  assert.equal(accuracy.passed, true);
  assert.equal(accuracy.value, 96.25);
  assert.equal(accuracy.comparison, ">=");
  assert.equal(misses.passed, true);
  assert.equal(misses.value, 2);
  assert.equal(misses.comparison, "<=");
});

test("evaluateMapConditions handles all map condition types", () => {
  const judged = evaluateMapConditions(
    [
      { type: "accuracy", threshold: 95 },
      { type: "score", threshold: 900000 },
      { type: "missCount", threshold: 2 },
      { type: "maxCombo", threshold: 800 },
    ],
    { accuracy: 96.25, score: 905432, countMiss: 2, maxCombo: 850 },
  );

  assert.equal(judged.passed, true);
  assert.deepEqual(
    judged.evaluations.map((evaluation) => evaluation.passed),
    [true, true, true, true],
  );
});

test("evaluateMapConditions fails when any AND condition fails", () => {
  const judged = evaluateMapConditions(
    [
      { type: "accuracy", threshold: 95 },
      { type: "missCount", threshold: 1 },
    ],
    { accuracy: 96.25, score: 905432, countMiss: 2, maxCombo: 850 },
  );

  assert.equal(judged.passed, false);
  assert.deepEqual(
    judged.evaluations.map((evaluation) => evaluation.passed),
    [true, false],
  );
});

test("evaluateCourseConditions handles aggregate course condition types", () => {
  const judged = evaluateCourseConditions(
    [
      { type: "courseAccuracy", threshold: 190 },
      { type: "totalScore", threshold: 1700000 },
      { type: "totalMissCount", threshold: 3 },
    ],
    mapResults(),
  );

  assert.equal(judged.passed, true);
  assert.deepEqual(
    judged.evaluations.map((evaluation) => evaluation.value),
    [190.5, 1815000, 1],
  );
});

test("judgeCourseRun passes when maps pass and overall list is empty", () => {
  const judged = judgeCourseRun(course([]), mapResults());

  assert.equal(judged.overall.length, 0);
  assert.equal(judged.passed, true);
});

test("judgeCourseRun returns failed overall evaluations", () => {
  const judged = judgeCourseRun(
    course([
      { type: "courseAccuracy", threshold: 191 },
      { type: "totalMissCount", threshold: 0 },
    ]),
    mapResults(),
  );

  assert.equal(judged.allMapsPassed, true);
  assert.equal(judged.overall.length, 2);
  assert.deepEqual(
    judged.overall.map((evaluation) => evaluation.passed),
    [false, false],
  );
  assert.equal(judged.passed, false);
});

test("judgeCourseRun skips overall evaluation when any map failed", () => {
  const [first, second] = mapResults();
  const judged = judgeCourseRun(
    course([{ type: "courseAccuracy", threshold: 100 }]),
    [first!, { ...second!, passed: false }],
  );

  assert.equal(judged.allMapsPassed, false);
  assert.equal(judged.overall.length, 0);
  assert.equal(judged.passed, false);
});

function course(
  overallPassConditions: CourseDefinition["overallPassConditions"],
): CourseDefinition {
  return {
    id: "course-1",
    danSystemId: "system-1",
    danSystemName: "test",
    danSystemSlug: "test",
    danSystemDescription: "",
    name: "test-1",
    slug: "test-1dan",
    description: "",
    tags: [],
    ordinal: 1,
    scoreModel: "scorev2",
    overallPassConditions,
    beatmaps: [],
  };
}

function mapResults(): JudgedMapResult[] {
  return [
    {
      id: "map-1",
      runId: "result-1",
      gameId: 1,
      beatmapId: 1,
      mods: "NF",
      passConditions: [{ type: "accuracy", threshold: 95 }],
      score: 910000,
      rawScore: 910000,
      playedMods: "NF",
      accuracy: 96,
      maxCombo: 1000,
      count300: 1,
      count100: 0,
      count50: 0,
      countMiss: 0,
      passed: true,
      ordinal: 1,
      createdAt: 1,
    },
    {
      id: "map-2",
      runId: "result-1",
      gameId: 2,
      beatmapId: 2,
      mods: "NF",
      passConditions: [{ type: "score", threshold: 800000 }],
      score: 905000,
      rawScore: 905000,
      playedMods: "NF",
      accuracy: 94.5,
      maxCombo: 900,
      count300: 1,
      count100: 0,
      count50: 0,
      countMiss: 1,
      passed: true,
      ordinal: 2,
      createdAt: 2,
    },
  ];
}
