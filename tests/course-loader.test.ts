import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadCoursesFromDir } from "@/db/courseLoader";
import { validateCourseMods } from "@/lib/mods";

function createTempDirectory() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "osudojo-courses-"));
  return {
    directory,
    cleanup() {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

test("course loader reads the seeded test course json", () => {
  const systems = loadCoursesFromDir(path.join(process.cwd(), "data/courses"));
  const courseSystem = systems.find((system) => system.slug === "test");

  assert.equal(courseSystem?.dans[0]?.courseSlug, "test-1dan");
  assert.equal(courseSystem?.dans[0]?.scoreModel, "scorev2");
  assert.equal(courseSystem?.dans[0]?.beatmaps[0]?.mods, "HR");
  assert.deepEqual(courseSystem?.dans[0]?.beatmaps[0]?.annotations, [
    "aim",
    "opening consistency",
  ]);
});

test("mod validator accepts the full ranked stable mod set we support in course json", () => {
  assert.equal(
    validateCourseMods("EZHTHDHRSDDTNCFLSOPFK4K5K6K7K8FIK9SV2MRNF"),
    "EZHTHDHRSDDTNCFLSOPFK4K5K6K7K8FIK9SV2MRNF",
  );
});

test("course loader rejects unsupported beatmap mods", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "invalid.json"),
      JSON.stringify({
        id: "system-invalid",
        name: "invalid",
        slug: "invalid",
        description: "invalid",
        dans: [
          {
            id: "dan-invalid",
            name: "invalid",
            courseSlug: "invalid-1",
            description: "invalid",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-invalid",
                beatmapId: 1,
                mods: "RX",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                title: "x",
                artist: "x",
                difficultyName: "x",
                mapper: "x",
                coverUrl: "https://example.com/x.jpg",
                annotations: ["x"],
              },
            ],
          },
        ],
      }),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /Unsupported mod string "RX"/,
    );
  } finally {
    temp.cleanup();
  }
});

test("course loader allows beatmap metadata to be omitted", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "optional-metadata.json"),
      JSON.stringify({
        id: "system-optional",
        name: "optional",
        slug: "optional",
        description: "optional",
        dans: [
          {
            id: "dan-optional",
            name: "optional",
            courseSlug: "optional-1",
            description: "optional",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-optional",
                beatmapId: 1,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                annotations: ["metadata resolved at seed time"],
              },
            ],
          },
        ],
      }),
    );

    const systems = loadCoursesFromDir(temp.directory);
    const beatmap = systems[0]?.dans[0]?.beatmaps[0];

    assert.equal(beatmap?.title, "");
    assert.equal(beatmap?.artist, "");
    assert.equal(beatmap?.difficultyName, "");
    assert.equal(beatmap?.mapper, "");
    assert.equal(beatmap?.coverUrl, "");
    assert.deepEqual(beatmap?.annotations, ["metadata resolved at seed time"]);
  } finally {
    temp.cleanup();
  }
});

test("course loader rejects unsupported score models", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "invalid-score.json"),
      JSON.stringify({
        id: "system-invalid-score",
        name: "invalid-score",
        slug: "invalid-score",
        description: "invalid-score",
        dans: [
          {
            id: "dan-invalid-score",
            name: "invalid-score",
            courseSlug: "invalid-score-1",
            description: "invalid-score",
            ordinal: 1,
            scoreModel: "legacy",
            overallPassType: "score",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-invalid-score",
                beatmapId: 1,
                mods: "",
                passConditionType: "score",
                passConditionThreshold: 95,
                ordinal: 1,
                title: "x",
                artist: "x",
                difficultyName: "x",
                mapper: "x",
                coverUrl: "https://example.com/x.jpg",
                annotations: ["x"],
              },
            ],
          },
        ],
      }),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /field "scoreModel" must be "scorev1" or "scorev2"/,
    );
  } finally {
    temp.cleanup();
  }
});

test("course loader rejects non-array annotations", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "invalid-annotations.json"),
      JSON.stringify({
        id: "system-invalid-annotations",
        name: "invalid-annotations",
        slug: "invalid-annotations",
        description: "invalid-annotations",
        dans: [
          {
            id: "dan-invalid-annotations",
            name: "invalid-annotations",
            courseSlug: "invalid-annotations-1",
            description: "invalid-annotations",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-invalid-annotations",
                beatmapId: 1,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                title: "x",
                artist: "x",
                difficultyName: "x",
                mapper: "x",
                coverUrl: "https://example.com/x.jpg",
                annotations: "not-an-array",
              },
            ],
          },
        ],
      }),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /field "annotations" must be an array of strings/,
    );
  } finally {
    temp.cleanup();
  }
});
