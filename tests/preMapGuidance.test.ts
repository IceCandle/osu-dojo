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

test("buildPreMapGuidance emits fixed-mod final score target inline without a support line", () => {
  const beatmap = createBeatmap({
    mods: "HR",
    passConditions: [
      { type: "accuracy", threshold: 95 },
      { type: "score", threshold: 1_000_001 },
    ],
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
    ["Targets: accuracy >= 95.00%, raw score >= 1,100,001"],
  );
});

test("buildPreMapGuidance emits FreeMod final score target in source order with raw choices", () => {
  const beatmap = createBeatmap({
    freemod: true,
    passConditions: [
      { type: "accuracy", threshold: 95 },
      { type: "score", threshold: 800_000 },
      { type: "missCount", threshold: 5 },
    ],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 1_500_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ score: 500_000 })],
      isFinalMap: true,
    }),
    [
      "Targets: accuracy >= 95.00%, adjusted score >= 1,000,000, miss <= 5",
      "FreeMod allowed: NF optional, NM, HD, HR, HDHR",
      "FreeMod active: add NF if you want the bot to receive your score after HP reaches 0.",
      "Raw score by choice: NM 1,000,000 / HD 1,060,000 / HR 1,100,000 / HDHR 1,166,000",
    ],
  );
});

test("buildPreMapGuidance appends FreeMod final course-only totalScore target with raw choices", () => {
  const beatmap = createBeatmap({
    freemod: true,
    passConditions: [
      { type: "accuracy", threshold: 95 },
      { type: "missCount", threshold: 5 },
    ],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 1_500_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ score: 500_000 })],
      isFinalMap: true,
    }),
    [
      "Targets: accuracy >= 95.00%, miss <= 5, adjusted score >= 1,000,000",
      "FreeMod allowed: NF optional, NM, HD, HR, HDHR",
      "FreeMod active: add NF if you want the bot to receive your score after HP reaches 0.",
      "Raw score by choice: NM 1,000,000 / HD 1,060,000 / HR 1,100,000 / HDHR 1,166,000",
    ],
  );
});

test("buildPreMapGuidance omits zero final totalScore target and FreeMod raw choices", () => {
  const beatmap = createBeatmap({
    freemod: true,
    passConditions: [{ type: "accuracy", threshold: 95 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 500_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [
        createPriorResult({ score: 600_000 }),
      ],
      isFinalMap: true,
    }),
    [
      "Targets: accuracy >= 95.00%",
      "FreeMod allowed: NF optional, NM, HD, HR, HDHR",
      "FreeMod active: add NF if you want the bot to receive your score after HP reaches 0.",
    ],
  );
});

test("buildPreMapGuidance omits zero fixed-mod final totalScore target", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "accuracy", threshold: 95 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 500_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [
        createPriorResult({ score: 600_000 }),
      ],
      isFinalMap: true,
    }),
    ["Targets: accuracy >= 95.00%"],
  );
});

test("buildPreMapGuidance suppresses final course targets after impossibility was announced", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "accuracy", threshold: 95 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "courseAccuracy", threshold: 190 }],
  });

  const lines = buildPreMapGuidance({
    course,
    beatmap,
    priorMapResults: [createPriorResult({ accuracy: 99, passed: false })],
    isFinalMap: true,
    courseAlreadyImpossible: true,
  });

  assert.ok(lines.includes("Targets: accuracy >= 95.00%"));
  assert.equal(lines.some((line) => line.startsWith("Course target:")), false);
});

test("buildPreMapGuidance keeps final map score target after suppressing totalScore", () => {
  const beatmap = createBeatmap({
    passConditions: [{ type: "score", threshold: 500_000 }],
  });
  const course = createCourse({
    beatmaps: [beatmap],
    overallPassConditions: [{ type: "totalScore", threshold: 2_000_000 }],
  });

  assert.deepEqual(
    buildPreMapGuidance({
      course,
      beatmap,
      priorMapResults: [createPriorResult({ score: 0 })],
      isFinalMap: true,
      courseAlreadyImpossible: true,
    }),
    ["Targets: raw score >= 500,000"],
  );
});
