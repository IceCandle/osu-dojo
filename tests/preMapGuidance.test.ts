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
    ["Targets: raw score >= 1,100,000, accuracy >= 95.50%"],
  );
});

test("buildPreMapGuidance converts fixed DT ScoreV2 targets to raw score units", () => {
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
    ["Targets: raw score >= 1,200,000"],
  );
});

test("buildPreMapGuidance emits adjusted FreeMod target and NF guidance", () => {
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
      "Targets: adjusted score >= 1,000,000",
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
    ["Targets: miss <= 5", "Course target: miss <= 1"],
  );
});

test("buildPreMapGuidance composes final-map totalScore and map score in adjusted units", () => {
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

  assert.deepEqual(lines, ["Raw target: >= 500,000"]);
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
      "Targets: max combo >= 100",
      "Course target: accuracy >= 90.00%",
      "Course target: miss <= 3",
      "Raw target: >= 1,000,000",
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
    ["Targets: max combo >= 100"],
  );
});

test("buildPreMapGuidance raw target uses stricter map score when totalScore remaining is lower", () => {
  const beatmap = createBeatmap({
    mods: "HR",
    passConditions: [{ type: "score", threshold: 1_000_001 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 900_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ score: 800_000 })],
      isFinalMap: true,
    }),
    [
      "Raw target: >= 1,100,001",
    ],
  );
});

test("buildPreMapGuidance emits FreeMod final score target with raw choices", () => {
  const beatmap = createBeatmap({
    freemod: true,
    passConditions: [{ type: "score", threshold: 1_000_000 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 1_000_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ score: 200_000 })],
      isFinalMap: true,
    }),
    [
      "Targets: adjusted score >= 1,000,000",
      "FreeMod allowed: NF optional, NM, HD, HR, HDHR",
      "FreeMod active: add NF if you want the bot to receive your score after HP reaches 0.",
      "Raw target by choice: NM 1,000,000 / HD 1,060,000 / HR 1,100,000 / HDHR 1,166,000",
    ],
  );
});

test("buildPreMapGuidance omits raw target when final totalScore is already satisfied", () => {
  const beatmap = createBeatmap({
    passConditions: [],
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
    [],
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
      "Targets: max combo >= 100",
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
    }).includes("Course target: miss <= 0"),
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
    }).includes("Course target: accuracy >= 190.00%"),
  );
});
