import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createTestDatabase } from "@/db/client";
import { loadCoursesFromDir } from "@/db/courseLoader";
import { getCourseByNameKey, listCourseRunsByNameKey } from "@/db/queries";
import { cloneCourseSystems, seedDatabase } from "@/db/seed";
import {
  addSampleBeatmapMetadata,
  createTempDatabaseUrl,
  markSeededCourseDraft,
  replaceSeedBeatmap,
  requireCourseBeatmap,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_COURSE_SLUG,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";

test("seedDatabase synchronizes updated draft beatmaps on an existing SQLite file", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const originalCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, systems);

    assert.ok(originalCourse);
    assert.ok(seededCourse);

    const updatedBeatmapId =
      requireCourseBeatmap(originalCourse, "beatmap-test-1").beatmapId + 1000;
    const newBeatmapId = updatedBeatmapId + 1;

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    replaceSeedBeatmap(seededCourse, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: updatedBeatmapId,
    }));
    seededCourse.beatmaps.push({
      id: "beatmap-test-3",
      beatmapId: newBeatmapId,
      mods: "DT",
      freemod: false,
      passConditions: [{ type: "accuracy", threshold: 50 }],
      ordinal: 3,
      title: "test stage three",
      artist: "osu!dojo",
      difficultyName: "Encore",
      mapper: "staff",
      coverUrl: "https://assets.ppy.sh/beatmaps/3/covers/cover.jpg",
      annotations: ["stamina", "extra stage"],
    });

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const updatedResults = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(updatedCourse);
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-1").beatmapId,
      updatedBeatmapId,
    );
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-2").beatmapId,
      requireCourseBeatmap(originalCourse, "beatmap-test-2").beatmapId,
    );
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-3").beatmapId,
      newBeatmapId,
    );
    assert.equal(updatedResults?.runs.length, 0);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase rejects gameplay edits on current systems", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

    assert.ok(seededCourse);
    seededCourse!.beatmaps[0] = {
      ...seededCourse!.beatmaps[0]!,
      passConditions: [{ type: "accuracy", threshold: 99 }],
    };

    await assert.rejects(
      () => seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true }),
      /immutable gameplay changes.*beatmaps/i,
    );
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase allows display metadata edits on current systems", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const system = systems[0];
    const seededCourse = system?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

    assert.ok(system);
    assert.ok(seededCourse);
    system!.ladder = "sample-ladder";
    system!.ladderOrder = 3;
    seededCourse!.official = true;
    seededCourse!.label = "S1";

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(updatedCourse?.danSystemLadder, "sample-ladder");
    assert.equal(updatedCourse?.danSystemLadderOrder, 3);
    assert.equal(updatedCourse?.official, true);
    assert.equal(updatedCourse?.label, "S1");
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase allows current systems to roll over to legacy keys", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));
    const system = systems[0];

    assert.ok(system);
    system!.name = "test 2025";
    system!.slug = "test-2025";
    system!.status = "legacy";

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const legacyCourse = await getCourseByNameKey(
      "test-2025",
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const oldKeyCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(legacyCourse?.slug, SEEDED_COURSE_SLUG);
    assert.equal(oldKeyCourse, null);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase rejects disallowed system status transitions", async () => {
  const cases: Array<{
    name: string;
    existing: "current" | "legacy" | "draft" | "archived";
    incoming: "current" | "legacy" | "draft" | "archived";
  }> = [
    { name: "current to draft", existing: "current", incoming: "draft" },
    { name: "legacy to draft", existing: "legacy", incoming: "draft" },
    { name: "draft to legacy", existing: "draft", incoming: "legacy" },
    { name: "archived to current", existing: "archived", incoming: "current" },
    { name: "archived to legacy", existing: "archived", incoming: "legacy" },
    { name: "archived to draft", existing: "archived", incoming: "draft" },
  ];

  for (const transitionCase of cases) {
    const temp = createTempDatabaseUrl();

    try {
      const { db } = await createTestDatabase(temp.url);
      db.$client
        .prepare("UPDATE dan_systems SET status = ? WHERE slug = ?")
        .run(transitionCase.existing, SEEDED_SYSTEM_NAME_KEY);

      const systems = cloneCourseSystems(
        loadCoursesFromDir(path.join(process.cwd(), "data/courses")),
      );
      systems[0]!.status = transitionCase.incoming;

      await assert.rejects(
        () => seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true }),
        new RegExp(
          `cannot transition from ${transitionCase.existing} to ${transitionCase.incoming}`,
        ),
        transitionCase.name,
      );
    } finally {
      temp.cleanup();
    }
  }
});

test("seedDatabase allows draft to publish with simultaneous gameplay edits", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    db.$client
      .prepare("UPDATE dan_systems SET status = 'draft' WHERE slug = ?")
      .run(SEEDED_SYSTEM_NAME_KEY);

    const originalCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systems = cloneCourseSystems(
      loadCoursesFromDir(path.join(process.cwd(), "data/courses")),
    );
    const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);

    assert.ok(originalCourse);
    assert.ok(seededCourse);

    systems[0]!.status = "current";
    replaceSeedBeatmap(seededCourse!, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: requireCourseBeatmap(originalCourse!, "beatmap-test-1").beatmapId + 10_000,
    }));

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const systemRow = db.$client
      .prepare("SELECT status FROM dan_systems WHERE slug = ?")
      .get(SEEDED_SYSTEM_NAME_KEY) as { status: string };

    assert.equal(systemRow.status, "current");
    assert.ok(updatedCourse);
    assert.equal(
      requireCourseBeatmap(updatedCourse, "beatmap-test-1").beatmapId,
      seededCourse!.beatmaps.find((beatmap) => beatmap.id === "beatmap-test-1")!.beatmapId,
    );
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase reuses existing resolved metadata when course JSON omits it", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    await seedDatabase(
      db,
      addSampleBeatmapMetadata(
        cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
      ),
      { suppressMissingObjectCountWarnings: true },
    );

    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = systems[0]?.courses.find((entry) => entry.slug === SEEDED_COURSE_SLUG);
    let resolverCalls = 0;

    assert.ok(seededCourse);

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    for (const beatmap of seededCourse.beatmaps) {
      beatmap.title = "";
      beatmap.artist = "";
      beatmap.difficultyName = "";
      beatmap.mapper = "";
      beatmap.coverUrl = "";
    }

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => {
        resolverCalls += 1;
        return { ok: false, reason: "resolver should not be called" };
      },
    });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(resolverCalls, 3);
    assert.ok(updatedCourse);
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-1").title, "test stage one");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-2").title, "test stage two");
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase preserves seeded metadata while resolving total object counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: null,
          totalObjects: 500,
        },
      }),
    });

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").title, "test stage one");
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, 500);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase reuses existing total object counts without clobbering JSON metadata", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Resolved title",
            artist: "Resolved artist",
            difficultyName: "Resolved difficulty",
            mapper: "Resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
          },
          totalObjects: 500,
        },
      }),
    });

    await seedDatabase(
      db,
      addSampleBeatmapMetadata(
        cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
      ),
      { suppressMissingObjectCountWarnings: true },
    );

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").title, "test stage one");
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, 500);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase does not reuse total object counts after beatmap id changes", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Resolved title",
            artist: "Resolved artist",
            difficultyName: "Resolved difficulty",
            mapper: "Resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
          },
          totalObjects: 500,
        },
      }),
    });

    const updatedSystems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, updatedSystems);

    assert.ok(seededCourse);
    replaceSeedBeatmap(seededCourse!, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: 123_456,
    }));

    await seedDatabase(db, updatedSystems, { suppressMissingObjectCountWarnings: true });

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").beatmapId, 123_456);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, null);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase keeps existing total object counts when resolver returns null counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses")));

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Initial resolved title",
            artist: "Initial resolved artist",
            difficultyName: "Initial resolved difficulty",
            mapper: "Initial resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/500/covers/cover.jpg",
          },
          totalObjects: 500,
        },
      }),
    });

    db.$client
      .prepare(
        `
        UPDATE beatmap_metadata
        SET title = '', artist = '', difficulty_name = '', mapper = '', cover_url = ''
        `,
      )
      .run();

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async () => ({
        ok: true,
        data: {
          metadata: {
            title: "Resolved title",
            artist: "Resolved artist",
            difficultyName: "Resolved difficulty",
            mapper: "Resolved mapper",
            coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
          },
          totalObjects: null,
        },
      }),
    });

    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(course);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").title, "Resolved title");
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").totalObjects, 500);
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase stores defaults for missing metadata when no resolver is configured", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, systems);

    assert.ok(seededCourse);

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    replaceSeedBeatmap(seededCourse, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: 8_888,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    }));

    await seedDatabase(db, systems, { suppressMissingObjectCountWarnings: true });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(updatedCourse);
    const updatedBeatmap = requireCourseBeatmap(updatedCourse, "beatmap-test-1");
    assert.equal(updatedBeatmap.title, "");
    assert.equal(updatedBeatmap.artist, "");
    assert.equal(updatedBeatmap.difficultyName, "");
    assert.equal(updatedBeatmap.mapper, "");
    assert.equal(updatedBeatmap.coverUrl, "");
  } finally {
    temp.cleanup();
  }
});

test("seedDatabase resolves missing metadata and stores defaults on resolver failure", async () => {
  const temp = createTempDatabaseUrl();
  const originalWarn = console.warn;
  const warnings: string[] = [];

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = addSampleBeatmapMetadata(
      cloneCourseSystems(loadCoursesFromDir(path.join(process.cwd(), "data/courses"))),
    );
    const seededCourse = markSeededCourseDraft(db, systems);
    const resolverBeatmapIds: number[] = [];

    assert.ok(seededCourse);

    if (!seededCourse) {
      throw new Error("Missing seeded test course.");
    }

    replaceSeedBeatmap(seededCourse, "beatmap-test-1", (beatmap) => ({
      ...beatmap,
      beatmapId: 9_999,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    }));
    replaceSeedBeatmap(seededCourse, "beatmap-test-2", (beatmap) => ({
      ...beatmap,
      beatmapId: 10_000,
      title: "",
      artist: "",
      difficultyName: "",
      mapper: "",
      coverUrl: "",
    }));

    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    await seedDatabase(db, systems, {
      metadataRequestDelayMs: 0,
      suppressMissingObjectCountWarnings: true,
      resolveMetadata: async (beatmapId) => {
        resolverBeatmapIds.push(beatmapId);

        return beatmapId === 9_999
          ? {
              ok: true,
              data: {
                metadata: {
                  title: "Resolved title",
                  artist: "Resolved artist",
                  difficultyName: "Resolved difficulty",
                  mapper: "Resolved mapper",
                  coverUrl: "https://assets.ppy.sh/beatmaps/999/covers/cover.jpg",
                },
                totalObjects: null,
              },
            }
          : { ok: false, reason: "missing metadata" };
      },
    });

    const updatedCourse = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.deepEqual(resolverBeatmapIds, [9_999, 10_000, 4_923_775]);
    assert.ok(updatedCourse);
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-1").title, "Resolved title");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-1").artist, "Resolved artist");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-2").title, "");
    assert.equal(requireCourseBeatmap(updatedCourse, "beatmap-test-2").artist, "");
    assert.ok(warnings.some((warning) => /10,000|10000/.test(warning)));
  } finally {
    console.warn = originalWarn;
    temp.cleanup();
  }
});
