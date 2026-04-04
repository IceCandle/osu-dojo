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

  assert.equal(courseSystem?.dans[0]?.slug, "test-1dan");
  assert.equal(courseSystem?.dans[0]?.beatmaps[0]?.mods, "HR");
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
            slug: "invalid-1",
            description: "invalid",
            ordinal: 1,
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
