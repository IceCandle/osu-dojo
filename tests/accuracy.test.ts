import test from "node:test";
import assert from "node:assert/strict";
import { calculateAccuracy } from "@/lib/accuracy";
import { judgeDanRun, judgeThreshold } from "@/lib/judging";

test("calculateAccuracy uses osu stable standard hit windows only", () => {
  const accuracy = calculateAccuracy({
    count300: 900,
    count100: 90,
    count50: 10,
    countMiss: 5,
  });

  assert.equal(accuracy?.toFixed(4), "92.7032");
});

test("calculateAccuracy returns null for unsupported score variants", () => {
  const accuracy = calculateAccuracy(
    {
      count300: 900,
      count100: 90,
      count50: 10,
      countMiss: 5,
    },
    { ruleset: "osu", client: "lazer" },
  );

  assert.equal(accuracy, null);
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

test("judgeThreshold compares accuracy and score against the proper field", () => {
  const acc = judgeThreshold("acc", 95, { accuracy: 96.25, score: 800000 });
  const sv2 = judgeThreshold("sv2", 900000, {
    accuracy: 90,
    score: 905432,
  });

  assert.equal(acc.passed, true);
  assert.equal(acc.value, 96.25);
  assert.equal(sv2.passed, true);
  assert.equal(sv2.value, 905432);
});

test("judgeDanRun averages accuracy for dan acc thresholds", () => {
  const judged = judgeDanRun(
    {
      id: "dan-1",
      danSystemId: "system-1",
      danSystemName: "test",
      name: "test-1",
      slug: "test-1dan",
      description: "",
      ordinal: 1,
      overallPassType: "acc",
      overallPassThreshold: 95,
      beatmaps: [],
    },
    [
      {
        id: "map-1",
        resultId: "result-1",
        beatmapId: 1,
        mods: "HDHRNF",
        passConditionType: "acc",
        passConditionThreshold: 95,
        score: 900000,
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
        resultId: "result-1",
        beatmapId: 2,
        mods: "HDDTNF",
        passConditionType: "acc",
        passConditionThreshold: 95,
        score: 900000,
        accuracy: 94.5,
        maxCombo: 900,
        count300: 1,
        count100: 0,
        count50: 0,
        countMiss: 0,
        passed: true,
        ordinal: 2,
        createdAt: 2,
      },
    ],
  );

  assert.equal(judged.overall?.value, 95.25);
  assert.equal(judged.passed, true);
});

test("judgeDanRun fails when maps pass but average accuracy misses the overall threshold", () => {
  const judged = judgeDanRun(
    {
      id: "dan-1",
      danSystemId: "system-1",
      danSystemName: "test",
      name: "test-1",
      slug: "test-1dan",
      description: "",
      ordinal: 1,
      overallPassType: "acc",
      overallPassThreshold: 95,
      beatmaps: [],
    },
    [
      {
        id: "map-1",
        resultId: "result-1",
        beatmapId: 1,
        mods: "HDHRNF",
        passConditionType: "acc",
        passConditionThreshold: 94,
        score: 900000,
        accuracy: 95,
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
        resultId: "result-1",
        beatmapId: 2,
        mods: "HDDTNF",
        passConditionType: "acc",
        passConditionThreshold: 94,
        score: 900000,
        accuracy: 94.5,
        maxCombo: 900,
        count300: 1,
        count100: 0,
        count50: 0,
        countMiss: 0,
        passed: true,
        ordinal: 2,
        createdAt: 2,
      },
    ],
  );

  assert.equal(judged.allMapsPassed, true);
  assert.notEqual(judged.overall, null);
  assert.equal(judged.overall?.value, 94.75);
  assert.equal(judged.overall?.passed, false);
  assert.equal(judged.passed, false);
});

test("judgeDanRun sums score for dan sv2 thresholds", () => {
  const judged = judgeDanRun(
    {
      id: "dan-1",
      danSystemId: "system-1",
      danSystemName: "test",
      name: "test-1",
      slug: "test-1dan",
      description: "",
      ordinal: 1,
      overallPassType: "sv2",
      overallPassThreshold: 1700000,
      beatmaps: [],
    },
    [
      {
        id: "map-1",
        resultId: "result-1",
        beatmapId: 1,
        mods: "NF",
        passConditionType: "sv2",
        passConditionThreshold: 800000,
        score: 910000,
        accuracy: 0,
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
        resultId: "result-1",
        beatmapId: 2,
        mods: "NF",
        passConditionType: "sv2",
        passConditionThreshold: 800000,
        score: 905000,
        accuracy: 0,
        maxCombo: 900,
        count300: 1,
        count100: 0,
        count50: 0,
        countMiss: 0,
        passed: true,
        ordinal: 2,
        createdAt: 2,
      },
    ],
  );

  assert.equal(judged.overall?.value, 1815000);
  assert.equal(judged.passed, true);
});
