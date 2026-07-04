import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTestDatabase } from "@/db/client";
import {
  getCourseByNameKey,
  listCoursesByDanSystemNameKey,
  listCourseRunsByNameKey,
  listDanSystemsWithCourses,
} from "@/db/queries";
import {
  createTempDatabaseUrl,
  requireCourseBeatmap,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_COURSE_SLUG,
  SEEDED_SECOND_COURSE_SLUG,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";

test("seeded queries expose the sample course and runs", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);
    const systems = await listDanSystemsWithCourses(db);
    const systemCourses = await listCoursesByDanSystemNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      db,
    );
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    const results = await listCourseRunsByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.equal(systems.length, 1);
    assert.equal(systemCourses.length, 2);
    assert.equal(systems[0]?.courses[0]?.slug, SEEDED_COURSE_SLUG);
    assert.equal(systems[0]?.courses[0]?.scoreModel, "scorev2");
    assert.equal(systems[0]?.courses[1]?.slug, SEEDED_SECOND_COURSE_SLUG);
    assert.equal(systems[0]?.courses[1]?.scoreModel, "scorev1");
    assert.ok(course);
    assert.equal(course.beatmaps.length, 2);
    assert.equal(requireCourseBeatmap(course, "beatmap-test-1").freemod, true);
    assert.equal(course.scoreModel, "scorev2");
    assert.match(course.danSystemDescription, /Sample dan system/i);
    assert.equal(results?.runs.length, 0);
  } finally {
    temp.cleanup();
  }
});

test("course queries hydrate and normalize beatmap total object counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);

    let course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(course?.beatmaps[0]?.totalObjects, null);

    db.$client
      .prepare(
        `
        UPDATE beatmap_metadata
        SET total_objects = ?
        WHERE beatmap_id = (
          SELECT beatmap_id
          FROM beatmaps
          WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
            AND ordinal = ?
        )
        `,
      )
      .run(710, SEEDED_COURSE_SLUG, 1);

    course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(course?.beatmaps[0]?.totalObjects, 710);

    db.$client.pragma("ignore_check_constraints = ON");
    db.$client
      .prepare(
        `
        UPDATE beatmap_metadata
        SET total_objects = ?
        WHERE beatmap_id = (
          SELECT beatmap_id
          FROM beatmaps
          WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
            AND ordinal = ?
        )
        `,
      )
      .run(-1, SEEDED_COURSE_SLUG, 1);
    db.$client.pragma("ignore_check_constraints = OFF");

    course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.equal(course?.beatmaps[0]?.totalObjects, null);
  } finally {
    temp.cleanup();
  }
});

test("createTestDatabase backfills run users without overwriting existing users", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const initial = await createTestDatabase(temp.url);
    initial.sqlite
      .prepare(
        "INSERT INTO users (osu_user_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(99, "ExistingCurrent", 10, 20);
    const insertRun = initial.sqlite.prepare(
      `INSERT INTO runs
        (id, user_id, username, course_id, passed, started_at, completed_at, match_id)
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
    );
    insertRun.run("run-a", 77, "OlderAlias", "course-test-1dan", 50, 200);
    insertRun.run("run-z", 77, "TieBreakAlias", "course-test-1dan", 100, 200);
    insertRun.run("run-existing", 99, "HistoricalAlias", "course-test-1dan", 1, 999);
    initial.sqlite.close();

    const migrated = await createTestDatabase(temp.url);
    assert.deepEqual(
      migrated.sqlite
        .prepare(
          `SELECT
             osu_user_id AS userId,
             username,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM users
           WHERE osu_user_id IN (77, 99)
           ORDER BY osu_user_id`,
        )
        .all(),
      [
        {
          userId: 77,
          username: "TieBreakAlias",
          createdAt: 50,
          updatedAt: 200,
        },
        {
          userId: 99,
          username: "ExistingCurrent",
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    );
    migrated.sqlite.close();

    const migratedAgain = await createTestDatabase(temp.url);
    const userCount = migratedAgain.sqlite
      .prepare("SELECT COUNT(*) AS count FROM users WHERE osu_user_id = 77")
      .get() as { count: number };
    assert.equal(userCount.count, 1);
    migratedAgain.sqlite.close();
  } finally {
    temp.cleanup();
  }
});

test("createTestDatabase rebuilds legacy pin settings and preserves visibility", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const sqlite = new Database(temp.filePath);
    sqlite.exec(`
      CREATE TABLE user_settings (
        user_id INTEGER PRIMARY KEY,
        profile_details_public INTEGER NOT NULL DEFAULT 1,
        pinned_mode TEXT NOT NULL DEFAULT 'auto',
        updated_at INTEGER NOT NULL
      );
      INSERT INTO user_settings
        (user_id, profile_details_public, pinned_mode, updated_at)
      VALUES (77, 0, 'manual', 1234);

      CREATE TABLE pinned_clears (
        user_id INTEGER NOT NULL,
        run_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        PRIMARY KEY (user_id, run_id),
        UNIQUE (user_id, ordinal)
      );
    `);
    sqlite.close();

    const migrated = await createTestDatabase(temp.url);
    assert.deepEqual(
      (
        migrated.sqlite.pragma("table_info(user_settings)") as Array<{
          name: string;
        }>
      ).map((column) => column.name),
      ["user_id", "profile_details_public", "updated_at"],
    );
    assert.deepEqual(
      migrated.sqlite
        .prepare(
          "SELECT user_id AS userId, profile_details_public AS profileDetailsPublic, updated_at AS updatedAt FROM user_settings",
        )
        .get(),
      { userId: 77, profileDetailsPublic: 0, updatedAt: 1234 },
    );
    assertCurrentPinnedShape(migrated.sqlite);
    migrated.sqlite.close();

    const migratedAgain = await createTestDatabase(temp.url);
    assertCurrentPinnedShape(migratedAgain.sqlite);
    migratedAgain.sqlite.close();
  } finally {
    temp.cleanup();
  }
});

test("createTestDatabase rebuilds exact-column pin tables with the wrong FK action", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const sqlite = new Database(temp.filePath);
    sqlite.exec(`
      CREATE TABLE pinned_clears (
        user_id INTEGER NOT NULL,
        course_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(id),
        pinned_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, course_id)
      );
    `);
    sqlite.close();

    const migrated = await createTestDatabase(temp.url);
    assertCurrentPinnedShape(migrated.sqlite);
    migrated.sqlite.close();
  } finally {
    temp.cleanup();
  }
});

test("createTestDatabase migrates old beatmaps tables with total object counts", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const sqlite = new Database(temp.filePath);
    sqlite.exec(`
      CREATE TABLE beatmaps (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        beatmap_id INTEGER NOT NULL,
        mods TEXT NOT NULL,
        pass_condition_type TEXT NOT NULL,
        pass_condition_threshold REAL NOT NULL,
        ordinal INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        artist TEXT NOT NULL DEFAULT '',
        difficulty_name TEXT NOT NULL DEFAULT '',
        mapper TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        annotations TEXT NOT NULL DEFAULT '[]'
      );
    `);
    sqlite.close();

    const { db, sqlite: migratedSqlite } = await createTestDatabase(temp.url);
    const columns = (
      migratedSqlite.pragma("table_info(beatmaps)") as { name: string }[]
    ).map((column) => column.name);
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );

    assert.ok(columns.includes("total_objects"));
    assert.equal(course?.beatmaps[0]?.totalObjects, null);
  } finally {
    temp.cleanup();
  }
});

function assertCurrentPinnedShape(sqlite: InstanceType<typeof Database>) {
  const columns = sqlite.pragma("table_info(pinned_clears)") as Array<{
    name: string;
    pk: number;
  }>;
  assert.deepEqual(
    columns.map((column) => column.name),
    ["user_id", "course_id", "run_id", "pinned_at"],
  );
  assert.deepEqual(
    columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name),
    ["user_id", "course_id"],
  );
  const foreignKey = (
    sqlite.pragma("foreign_key_list(pinned_clears)") as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>
  ).find((candidate) => candidate.from === "run_id");
  assert.deepEqual(foreignKey, {
    id: 0,
    seq: 0,
    table: "runs",
    from: "run_id",
    to: "id",
    on_update: "NO ACTION",
    on_delete: "CASCADE",
    match: "NONE",
  });
  const index = (
    sqlite.pragma("index_list(pinned_clears)") as Array<{ name: string }>
  ).find((candidate) => candidate.name === "pinned_clears_user_pinned_idx");
  assert.ok(index);
}

test("createTestDatabase backfills legacy pass condition columns", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const sqlite = new Database(temp.filePath);
    sqlite.exec(`
      CREATE TABLE dan_systems (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'current'
      );
      CREATE TABLE courses (
        id TEXT PRIMARY KEY,
        dan_system_id TEXT NOT NULL REFERENCES dan_systems(id),
        creator_user_id INTEGER,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        ordinal INTEGER NOT NULL,
        score_model TEXT NOT NULL DEFAULT 'scorev2',
        overall_pass_type TEXT,
        overall_pass_threshold REAL,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(dan_system_id, slug)
      );
      CREATE TABLE beatmaps (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id),
        beatmap_id INTEGER NOT NULL,
        mods TEXT NOT NULL,
        pass_condition_type TEXT NOT NULL,
        pass_condition_threshold REAL NOT NULL,
        ordinal INTEGER NOT NULL,
        annotations TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        course_id TEXT NOT NULL REFERENCES courses(id),
        passed INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        match_id INTEGER
      );
      CREATE TABLE map_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        game_id INTEGER,
        beatmap_id INTEGER NOT NULL,
        mods TEXT NOT NULL,
        pass_condition_type TEXT NOT NULL,
        pass_condition_threshold REAL NOT NULL,
        ordinal INTEGER NOT NULL,
        score INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        max_combo INTEGER NOT NULL,
        count_300 INTEGER NOT NULL,
        count_100 INTEGER NOT NULL,
        count_50 INTEGER NOT NULL,
        count_miss INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      INSERT INTO dan_systems (id, name, slug, description, status)
      VALUES ('system-old', 'old', 'old', 'old', 'draft');
      INSERT INTO courses (
        id,
        dan_system_id,
        name,
        slug,
        description,
        ordinal,
        score_model,
        overall_pass_type,
        overall_pass_threshold
      )
      VALUES ('course-old', 'system-old', 'old', 'old', 'old', 1, 'scorev2', 'acc', 95);
      INSERT INTO beatmaps (
        id,
        course_id,
        beatmap_id,
        mods,
        pass_condition_type,
        pass_condition_threshold,
        ordinal
      )
      VALUES ('beatmap-old', 'course-old', 1, '', 'score', 10000, 1);
      INSERT INTO runs (
        id,
        user_id,
        username,
        course_id,
        passed,
        started_at,
        completed_at
      )
      VALUES ('run-old', 1, 'OldPlayer', 'course-old', 1, 1, 2);
      INSERT INTO map_results (
        id,
        run_id,
        beatmap_id,
        mods,
        pass_condition_type,
        pass_condition_threshold,
        ordinal,
        score,
        accuracy,
        max_combo,
        count_300,
        count_100,
        count_50,
        count_miss,
        passed
      )
      VALUES ('map-result-old', 'run-old', 1, '', 'acc', 95, 1, 10000, 96, 100, 1, 0, 0, 0, 1);
    `);
    sqlite.close();

    const { sqlite: migratedSqlite } = await createTestDatabase(temp.url);
    const course = migratedSqlite
      .prepare("SELECT overall_pass_conditions FROM courses WHERE id = ?")
      .get("course-old") as { overall_pass_conditions: string };
    const beatmap = migratedSqlite
      .prepare("SELECT pass_conditions FROM beatmaps WHERE id = ?")
      .get("beatmap-old") as { pass_conditions: string };
    const mapResult = migratedSqlite
      .prepare("SELECT pass_conditions, raw_score, played_mods FROM map_results WHERE id = ?")
      .get("map-result-old") as {
        pass_conditions: string;
        raw_score: number;
        played_mods: string;
      };
    const beatmapColumns = (
      migratedSqlite.pragma("table_info(beatmaps)") as { name: string }[]
    ).map((column) => column.name);
    const mapResultColumns = (
      migratedSqlite.pragma("table_info(map_results)") as { name: string }[]
    ).map((column) => column.name);
    const openLobbyColumns = (
      migratedSqlite.pragma("table_info(open_lobbies)") as { name: string }[]
    ).map((column) => column.name);

    assert.deepEqual(JSON.parse(course.overall_pass_conditions), [
      { type: "courseAccuracy", threshold: 95 },
    ]);
    assert.deepEqual(JSON.parse(beatmap.pass_conditions), [
      { type: "score", threshold: 10000 },
    ]);
    assert.deepEqual(JSON.parse(mapResult.pass_conditions), [
      { type: "accuracy", threshold: 95 },
    ]);
    assert.equal(mapResult.raw_score, 10000);
    assert.equal(mapResult.played_mods, "");
    assert.equal(beatmapColumns.includes("freemod"), true);
    assert.equal(mapResultColumns.includes("raw_score"), true);
    assert.equal(mapResultColumns.includes("played_mods"), true);
    assert.equal(beatmapColumns.includes("pass_condition_type"), false);
    assert.deepEqual(openLobbyColumns, ["match_id", "user_id", "course_id", "opened_at"]);
  } finally {
    temp.cleanup();
  }
});

test("course reads reject stale map pass condition types", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);

    db.$client
      .prepare(
        `
        UPDATE beatmaps
        SET pass_conditions = ?
        WHERE course_id = (SELECT id FROM courses WHERE slug = ?)
          AND ordinal = ?
        `,
      )
      .run(
        JSON.stringify([{ type: "acc", threshold: 95 }]),
        SEEDED_COURSE_SLUG,
        1,
      );

    await assert.rejects(
      () =>
        getCourseByNameKey(
          SEEDED_SYSTEM_NAME_KEY,
          SEEDED_COURSE_NAME_KEY,
          db,
        ),
      /map pass conditions for beatmap 259 type "acc" is not valid/,
    );
  } finally {
    temp.cleanup();
  }
});

test("course reads reject map-only types in course pass conditions", async () => {
  const temp = createTempDatabaseUrl();

  try {
    const { db } = await createTestDatabase(temp.url);

    db.$client
      .prepare("UPDATE courses SET overall_pass_conditions = ? WHERE slug = ?")
      .run(
        JSON.stringify([{ type: "accuracy", threshold: 95 }]),
        SEEDED_COURSE_SLUG,
      );

    await assert.rejects(
      () =>
        getCourseByNameKey(
          SEEDED_SYSTEM_NAME_KEY,
          SEEDED_COURSE_NAME_KEY,
          db,
        ),
      /course pass conditions for course "test-1dan" type "accuracy" is not valid/,
    );
  } finally {
    temp.cleanup();
  }
});
