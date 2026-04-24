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

  assert.ok(courseSystem);
  assert.ok(courseSystem.courses.length > 0);

  for (const course of courseSystem.courses) {
    assert.equal(typeof course.slug, "string");
    assert.match(course.slug, /\S/);
    assert.match(course.scoreModel, /^scorev[12]$/);
    assert.ok(course.beatmaps.length > 0);

    for (const beatmap of course.beatmaps) {
      assert.equal(typeof beatmap.beatmapId, "number");
      assert.equal(Number.isInteger(beatmap.beatmapId), true);
      assert.equal(typeof beatmap.mods, "string");
      assert.match(beatmap.passConditionType, /^(acc|score)$/);
      assert.equal(typeof beatmap.passConditionThreshold, "number");
      assert.equal(typeof beatmap.ordinal, "number");
      assert.equal(Number.isInteger(beatmap.ordinal), true);
    }
  }
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
        courses: [
          {
            id: "course-invalid",
            name: "invalid",
            slug: "invalid-1",
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
        courses: [
          {
            id: "course-optional",
            name: "optional",
            slug: "optional-1",
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
    const beatmap = systems[0]?.courses[0]?.beatmaps[0];

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

test("course loader rejects legacy dans array key", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "legacy-dans.json"),
      JSON.stringify({
        id: "system-legacy",
        name: "legacy",
        slug: "legacy",
        description: "legacy",
        dans: [],
      }),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /field "courses" must be an array/,
    );
  } finally {
    temp.cleanup();
  }
});

test("course loader rejects legacy courseSlug field", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "legacy-course-slug.json"),
      JSON.stringify({
        id: "system-legacy-slug",
        name: "legacy slug",
        slug: "legacy-slug",
        description: "legacy-slug",
        courses: [
          {
            id: "course-legacy-slug",
            name: "legacy",
            courseSlug: "legacy-1",
            description: "legacy",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-legacy-slug",
                beatmapId: 1,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                annotations: ["x"],
              },
            ],
          },
        ],
      }),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /field "slug" must be a string/,
    );
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
        name: "invalid score",
        slug: "invalid-score",
        description: "invalid-score",
        courses: [
          {
            id: "course-invalid-score",
            name: "invalid score",
            slug: "invalid-score-1",
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
        name: "invalid annotations",
        slug: "invalid-annotations",
        description: "invalid-annotations",
        courses: [
          {
            id: "course-invalid-annotations",
            name: "invalid annotations",
            slug: "invalid-annotations-1",
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

test("course loader rejects display names outside the public key contract", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "invalid-name.json"),
      JSON.stringify({
        id: "system-invalid-name",
        name: "Invalid-Name",
        slug: "invalid-name",
        description: "invalid",
        courses: [
          {
            id: "course-invalid-name",
            name: "Valid Name",
            slug: "invalid-name-1",
            description: "invalid",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-invalid-name",
                beatmapId: 1,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                annotations: ["x"],
              },
            ],
          },
        ],
      }),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /field "name" must match/,
    );
  } finally {
    temp.cleanup();
  }
});

test("course loader rejects duplicate display name keys", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "duplicates.json"),
      JSON.stringify({
        id: "system-duplicates",
        name: "duplicates",
        slug: "duplicates",
        description: "duplicates",
        courses: [
          {
            id: "course-duplicates-1",
            name: "First Dan",
            slug: "first-dan",
            description: "duplicates",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-duplicates-1",
                beatmapId: 1,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                annotations: ["x"],
              },
            ],
          },
          {
            id: "course-duplicates-2",
            name: "first dan",
            slug: "first-dan-copy",
            description: "duplicates",
            ordinal: 2,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-duplicates-2",
                beatmapId: 2,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                annotations: ["x"],
              },
            ],
          },
        ],
      }),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /Duplicate course display name key "first-dan"/,
    );
  } finally {
    temp.cleanup();
  }
});

test("course loader reads system status and defaults to current", () => {
  const temp = createTempDirectory();

  try {
    writeFileSync(
      path.join(temp.directory, "draft.json"),
      JSON.stringify({
        id: "system-draft",
        name: "draft system",
        slug: "draft-system",
        description: "draft",
        status: "draft",
        courses: [
          {
            id: "course-draft",
            name: "draft",
            slug: "draft",
            description: "draft",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-old",
                beatmapId: 1,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                annotations: ["x"],
              },
            ],
          },
        ],
      }),
    );
    writeFileSync(
      path.join(temp.directory, "current.json"),
      JSON.stringify({
        id: "system-current",
        name: "current system",
        slug: "current-system",
        description: "current",
        courses: [
          {
            id: "course-current",
            name: "current",
            slug: "current",
            description: "current",
            ordinal: 1,
            scoreModel: "scorev2",
            overallPassType: "acc",
            overallPassThreshold: 95,
            beatmaps: [
              {
                id: "beatmap-current",
                beatmapId: 2,
                mods: "",
                passConditionType: "acc",
                passConditionThreshold: 95,
                ordinal: 1,
                annotations: ["x"],
              },
            ],
          },
        ],
      }),
    );

    const systems = loadCoursesFromDir(temp.directory);
    assert.equal(systems.find((system) => system.id === "system-draft")?.status, "draft");
    assert.equal(
      systems.find((system) => system.id === "system-current")?.status,
      "current",
    );
    assert.equal("status" in systems[0]!.courses[0]!, false);
  } finally {
    temp.cleanup();
  }
});

test("course loader rejects duplicate system keys regardless of status", () => {
  const temp = createTempDirectory();

  try {
    const system = (id: string, status: string) => ({
      id,
      name: "duplicate",
      slug: id,
      description: id,
      status,
      courses: [
        {
          id: `${id}-course`,
          name: id.replace(/-/g, " "),
          slug: `${id}-course`,
          description: id,
          ordinal: 1,
          scoreModel: "scorev2",
          overallPassType: "acc",
          overallPassThreshold: 95,
          beatmaps: [
            {
              id: `${id}-beatmap`,
              beatmapId: 1,
              mods: "",
              passConditionType: "acc",
              passConditionThreshold: 95,
              ordinal: 1,
              annotations: ["x"],
            },
          ],
        },
      ],
    });
    writeFileSync(
      path.join(temp.directory, "current.json"),
      JSON.stringify(system("system-current", "current")),
    );
    writeFileSync(
      path.join(temp.directory, "legacy.json"),
      JSON.stringify(system("system-legacy", "legacy")),
    );

    assert.throws(
      () => loadCoursesFromDir(temp.directory),
      /Duplicate system display name key "duplicate"/,
    );
  } finally {
    temp.cleanup();
  }
});
