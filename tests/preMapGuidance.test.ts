import test from "node:test";
import assert from "node:assert/strict";
import type {
  CourseBeatmapDefinition,
  CourseDefinition,
  JudgedMapResult,
} from "@/lib/domain";
import { buildPreMapGuidance } from "@/lib/preMapGuidance";

function createCourse(overrides: Partial<CourseDefinition> = {}): CourseDefinition {
  const beatmap = createBeatmap();

  return {
    id: "course-test",
    danSystemId: "system-test",
    danSystemName: "test",
    danSystemSlug: "test",
    danSystemDescription: "test",
    name: "1st",
    slug: "1st",
    description: "test",
    tags: [],
    ordinal: 1,
    scoreModel: "scorev2",
    overallPassConditions: [],
    beatmaps: [beatmap],
    ...overrides,
  };
}

function createBeatmap(
  overrides: Partial<CourseBeatmapDefinition> = {},
): CourseBeatmapDefinition {
  return {
    id: "beatmap-test",
    beatmapId: 12345,
    mods: "",
    freemod: false,
    passConditions: [],
    ordinal: 1,
    title: "Title",
    artist: "Artist",
    difficultyName: "Hard",
    mapper: "Mapper",
    coverUrl: "",
    totalObjects: null,
    annotations: [],
    ...overrides,
  };
}

function createPriorResult(
  overrides: Partial<JudgedMapResult> = {},
): Pick<JudgedMapResult, "accuracy" | "countMiss" | "passed" | "score"> {
  return {
    accuracy: 95,
    countMiss: 0,
    passed: true,
    score: 500_000,
    ...overrides,
  };
}

test("buildPreMapGuidance emits fixed-mod ScoreV2 raw score and map targets", () => {
  const beatmap = createBeatmap({
    mods: "HR",
    passConditions: [
      { type: "score", threshold: 1_000_000 },
      { type: "accuracy", threshold: 95.5 },
    ],
  });
  const course = createCourse({ beatmaps: [beatmap] });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [],
      isFinalMap: false,
    }),
    ["Targets: score >= 1,000,000, 95.50%+ acc"],
  );
});

test("buildPreMapGuidance leaves fixed DT ScoreV2 targets on raw score", () => {
  const beatmap = createBeatmap({
    mods: "DT",
    passConditions: [{ type: "score", threshold: 1_000_000 }],
  });
  const course = createCourse({ beatmaps: [beatmap] });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [],
      isFinalMap: false,
    }),
    ["Targets: score >= 1,000,000"],
  );
});

test("buildPreMapGuidance emits one raw FreeMod target and NF guidance", () => {
  const beatmap = createBeatmap({
    freemod: true,
    passConditions: [{ type: "score", threshold: 1_000_000 }],
  });
  const course = createCourse({ beatmaps: [beatmap] });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [],
      isFinalMap: false,
    }),
    [
      "Targets: score >= 1,000,000",
      "FreeMod allowed: NF optional, NM, HD, HR, HDHR",
      "FreeMod active: add NF if you want the bot to receive your score after HP reaches 0.",
    ],
  );
});

test("buildPreMapGuidance leaves ScoreV1 score thresholds on the raw scale", () => {
  const beatmap = createBeatmap({
    mods: "HR",
    passConditions: [{ type: "score", threshold: 1_000_000 }],
  });
  const course = createCourse({ beatmaps: [beatmap], scoreModel: "scorev1" });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [],
      isFinalMap: false,
    }),
    ["Targets: score >= 1,000,000"],
  );
});

test("buildPreMapGuidance emits stricter final-map miss budget course target", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "missCount", threshold: 5 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalMissCount", threshold: 3 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ countMiss: 2 })],
      isFinalMap: true,
    }),
    ["Targets: <=5 miss", "Course target: 1 miss"],
  );
});

test("buildPreMapGuidance omits totalScore course target when map score is stricter", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "score", threshold: 500_000 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 900_000 }],
  });

  const lines = buildPreMapGuidance({
    course,
    beatmap,
    priorMapResults: [createPriorResult({ score: 600_000 })],
    isFinalMap: true,
  });

  assert.deepEqual(lines, ["Targets: score >= 500,000"]);
});

test("buildPreMapGuidance announces course targets without matching map conditions", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "maxCombo", threshold: 100 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [
      { type: "courseAccuracy", threshold: 90 },
      { type: "totalScore", threshold: 1_000_000 },
      { type: "totalMissCount", threshold: 3 },
    ],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [],
      isFinalMap: true,
    }),
    [
      "Targets: 100+ combo",
      "Course target: 90.00%+ acc",
      "Course target: totalScore >= 1,000,000",
      "Course target: 3 miss",
    ],
  );
});

test("buildPreMapGuidance explains already satisfied score without a matching map condition", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "maxCombo", threshold: 100 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 500_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ score: 600_000 })],
      isFinalMap: true,
    }),
    [
      "Targets: 100+ combo",
      "Course target: totalScore already satisfied (600,000 / 500,000)",
    ],
  );
});

test("buildPreMapGuidance explains already satisfied course accuracy with progress", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "maxCombo", threshold: 100 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "courseAccuracy", threshold: 190 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [
        createPriorResult({ accuracy: 96 }),
        createPriorResult({ accuracy: 95 }),
      ],
      isFinalMap: true,
    }),
    [
      "Targets: 100+ combo",
      "Course target: courseAccuracy already satisfied (191.00% / 190.00%)",
    ],
  );
});

test("buildPreMapGuidance renders exhausted and overrun miss budgets without negatives", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "missCount", threshold: 3 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalMissCount", threshold: 1 }],
  });

  assert.ok(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ countMiss: 1 })],
      isFinalMap: true,
    }).includes("Course target: 0 miss"),
  );
  assert.ok(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ countMiss: 2 })],
      isFinalMap: true,
    }).includes("Course target: totalMissCount already exceeded (2 / 1)"),
  );
});

test("buildPreMapGuidance still evaluates final course targets after a failed prior map", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "accuracy", threshold: 95 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "courseAccuracy", threshold: 190 }],
  });

  assert.ok(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ accuracy: 99, passed: false })],
      isFinalMap: true,
    }).includes("Course target: 190.00%+ acc"),
  );
});
