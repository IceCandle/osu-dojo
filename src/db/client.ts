import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { seedDatabase, type SeedOptions } from "@/db/seed";
import { fetchBeatmapMetadata } from "@/lib/beatmapMetadata";

type BetterSqliteConnection = InstanceType<typeof Database>;

export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $client: BetterSqliteConnection;
};

interface DatabaseBundle {
  db: AppDatabase;
  sqlite: BetterSqliteConnection;
}

declare global {
  var __osuDojoDatabaseBundle: DatabaseBundle | undefined;
}

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS dan_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'current',
  ladder TEXT,
  ladder_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  dan_system_id TEXT NOT NULL REFERENCES dan_systems(id),
  creator_user_id INTEGER,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  ordinal INTEGER NOT NULL,
  official INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  score_model TEXT NOT NULL DEFAULT 'scorev2',
  overall_pass_conditions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(dan_system_id, slug)
);

CREATE TABLE IF NOT EXISTS beatmaps (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  beatmap_id INTEGER NOT NULL,
  mods TEXT NOT NULL,
  freemod INTEGER NOT NULL DEFAULT 0,
  pass_conditions TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  annotations TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS beatmap_metadata (
  beatmap_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  difficulty_name TEXT NOT NULL DEFAULT '',
  mapper TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  total_objects INTEGER CHECK (total_objects IS NULL OR total_objects >= 0),
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  passed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  match_id INTEGER
);

CREATE TABLE IF NOT EXISTS map_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  game_id INTEGER,
  beatmap_id INTEGER NOT NULL,
  mods TEXT NOT NULL,
  pass_conditions TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score INTEGER NOT NULL,
  raw_score INTEGER NOT NULL DEFAULT 0,
  played_mods TEXT NOT NULL DEFAULT '',
  accuracy REAL NOT NULL,
  max_combo INTEGER NOT NULL,
  count_300 INTEGER NOT NULL,
  count_100 INTEGER NOT NULL,
  count_50 INTEGER NOT NULL,
  count_miss INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS open_lobbies (
  match_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  return_to TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  osu_user_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  profile_details_public INTEGER NOT NULL DEFAULT 1
    CHECK(profile_details_public IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pinned_clears (
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS courses_system_ordinal_idx
  ON courses(dan_system_id, ordinal);

CREATE INDEX IF NOT EXISTS beatmaps_course_ordinal_idx
  ON beatmaps(course_id, ordinal);

CREATE INDEX IF NOT EXISTS runs_course_completed_idx
  ON runs(course_id, completed_at);

CREATE INDEX IF NOT EXISTS runs_user_completed_idx
  ON runs(user_id, completed_at);

CREATE INDEX IF NOT EXISTS map_results_run_ordinal_idx
  ON map_results(run_id, ordinal);

CREATE INDEX IF NOT EXISTS oauth_states_expires_idx
  ON oauth_states(expires_at);

CREATE INDEX IF NOT EXISTS sessions_expires_idx
  ON sessions(expires_at);

`;

function resolveDatabaseSource(url: string): string {
  if (url === ":memory:" || url === "file::memory:") {
    return ":memory:";
  }

  if (!url.startsWith("file:")) {
    return path.resolve(process.cwd(), url);
  }

  const filePath = url.slice("file:".length);
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

async function initializeDatabaseBundle(
  url = process.env["DATABASE_URL"] ?? "file:./dojo.db",
  seedOptions = getSeedOptionsFromEnvironment(),
): Promise<DatabaseBundle> {
  const source = resolveDatabaseSource(url);
  const sqlite = new Database(source);
  sqlite.pragma("foreign_keys = ON");
  if (source !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
  }
  sqlite.exec(CREATE_TABLES_SQL);
  migrateDatabase(sqlite);

  const db = drizzle(sqlite, { schema }) as AppDatabase;
  await seedDatabase(db, undefined, seedOptions);

  return { db, sqlite };
}

export async function getDatabase(): Promise<AppDatabase> {
  if (!globalThis.__osuDojoDatabaseBundle) {
    globalThis.__osuDojoDatabaseBundle = await initializeDatabaseBundle();
  }

  return globalThis.__osuDojoDatabaseBundle.db;
}

export async function createTestDatabase(url: string): Promise<DatabaseBundle> {
  return initializeDatabaseBundle(url, { suppressMissingObjectCountWarnings: true });
}

function migrateDatabase(sqlite: BetterSqliteConnection) {
  const systemColumns = (sqlite.pragma("table_info(dan_systems)") as Array<{ name: string }>)
    .map((col) => col.name);
  addColumnIfMissing(
    sqlite,
    "dan_systems",
    systemColumns,
    "status TEXT NOT NULL DEFAULT 'current'",
  );
  addColumnIfMissing(sqlite, "dan_systems", systemColumns, "ladder TEXT");
  addColumnIfMissing(
    sqlite,
    "dan_systems",
    systemColumns,
    "ladder_order INTEGER NOT NULL DEFAULT 0",
  );

  const courseColumns = (sqlite.pragma("table_info(courses)") as Array<{ name: string }>)
    .map((col) => col.name);

  addColumnIfMissing(sqlite, "courses", courseColumns, "creator_user_id INTEGER");
  addColumnIfMissing(sqlite, "courses", courseColumns, "tags TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(
    sqlite,
    "courses",
    courseColumns,
    "official INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(sqlite, "courses", courseColumns, "label TEXT");
  addColumnIfMissing(
    sqlite,
    "courses",
    courseColumns,
    "overall_pass_conditions TEXT DEFAULT '[]'",
  );
  addColumnIfMissing(sqlite, "courses", courseColumns, "created_at INTEGER");
  addColumnIfMissing(sqlite, "courses", courseColumns, "updated_at INTEGER");
  backfillCoursePassConditions(sqlite, courseColumns);
  dropLegacyConditionColumns(sqlite, "courses", [
    "overall_pass_type",
    "overall_pass_threshold",
  ]);
  sqlite.exec(`
    UPDATE courses
    SET created_at = COALESCE(created_at, unixepoch() * 1000),
        overall_pass_conditions = COALESCE(overall_pass_conditions, '[]'),
        updated_at = COALESCE(updated_at, unixepoch() * 1000)
  `);

  const beatmapColumns = (sqlite.pragma("table_info(beatmaps)") as Array<{ name: string }>)
    .map((col) => col.name);
  addColumnIfMissing(sqlite, "beatmaps", beatmapColumns, "freemod INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "beatmaps", beatmapColumns, "pass_conditions TEXT");
  backfillMapPassConditions(sqlite, "beatmaps", beatmapColumns);
  dropLegacyConditionColumns(sqlite, "beatmaps", [
    "pass_condition_type",
    "pass_condition_threshold",
  ]);

  if (beatmapColumns.includes("title") && !beatmapColumns.includes("total_objects")) {
    sqlite.exec(
      "ALTER TABLE beatmaps ADD COLUMN total_objects INTEGER CHECK (total_objects IS NULL OR total_objects >= 0)",
    );
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS beatmap_metadata (
      beatmap_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      difficulty_name TEXT NOT NULL DEFAULT '',
      mapper TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      total_objects INTEGER CHECK (total_objects IS NULL OR total_objects >= 0),
      fetched_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

  `);

  const metadataColumns = new Set(
    (sqlite.pragma("table_info(beatmaps)") as Array<{ name: string }>).map(
      (col) => col.name,
    ),
  );
  if (
    metadataColumns.has("title") &&
    metadataColumns.has("artist") &&
    metadataColumns.has("difficulty_name") &&
    metadataColumns.has("mapper") &&
    metadataColumns.has("cover_url") &&
    metadataColumns.has("total_objects")
  ) {
    sqlite.exec(`
      INSERT OR IGNORE INTO beatmap_metadata (
        beatmap_id,
        title,
        artist,
        difficulty_name,
        mapper,
        cover_url,
        total_objects,
        fetched_at
      )
      SELECT
        beatmap_id,
        COALESCE(NULLIF(title, ''), ''),
        COALESCE(NULLIF(artist, ''), ''),
        COALESCE(NULLIF(difficulty_name, ''), ''),
        COALESCE(NULLIF(mapper, ''), ''),
        COALESCE(NULLIF(cover_url, ''), ''),
        total_objects,
        unixepoch() * 1000
      FROM beatmaps;
    `);
  }

  const mapResultColumns = (
    sqlite.pragma("table_info(map_results)") as Array<{ name: string }>
  ).map((col) => col.name);
  addColumnIfMissing(sqlite, "map_results", mapResultColumns, "raw_score INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "map_results", mapResultColumns, "played_mods TEXT NOT NULL DEFAULT ''");
  sqlite.exec("UPDATE map_results SET raw_score = score WHERE raw_score = 0 AND score <> 0");
  sqlite.exec("UPDATE map_results SET played_mods = mods WHERE played_mods = ''");
  addColumnIfMissing(sqlite, "map_results", mapResultColumns, "pass_conditions TEXT");
  backfillMapPassConditions(sqlite, "map_results", mapResultColumns);
  dropLegacyConditionColumns(sqlite, "map_results", [
    "pass_condition_type",
    "pass_condition_threshold",
  ]);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS open_lobbies (
      match_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      course_id TEXT NOT NULL,
      opened_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);
  backfillUsersFromRuns(sqlite);
  migrateSettingsTables(sqlite);
  ensureIndexes(sqlite);
}

function backfillUsersFromRuns(sqlite: BetterSqliteConnection) {
  sqlite.transaction(() => {
    sqlite.exec(`
      INSERT INTO users (osu_user_id, username, created_at, updated_at)
      SELECT
        r.user_id,
        (
          SELECT latest.username
          FROM runs latest
          WHERE latest.user_id = r.user_id
          ORDER BY latest.completed_at DESC, latest.id DESC
          LIMIT 1
        ),
        MIN(r.started_at),
        MAX(r.completed_at)
      FROM runs r
      LEFT JOIN users u ON u.osu_user_id = r.user_id
      WHERE u.osu_user_id IS NULL
      GROUP BY r.user_id
      ON CONFLICT(osu_user_id) DO NOTHING;
    `);
  })();
}

function migrateSettingsTables(sqlite: BetterSqliteConnection) {
  const userSettingsColumns = getColumnNames(sqlite, "user_settings");
  const pinnedClearsIsCurrent = hasCurrentPinnedClearsShape(sqlite);
  if (!userSettingsColumns.includes("pinned_mode") && pinnedClearsIsCurrent) {
    return;
  }

  sqlite.transaction(() => {
    if (userSettingsColumns.includes("pinned_mode")) {
      sqlite.exec(`
        CREATE TABLE user_settings_new (
          user_id INTEGER PRIMARY KEY,
          profile_details_public INTEGER NOT NULL DEFAULT 1
            CHECK(profile_details_public IN (0, 1)),
          updated_at INTEGER NOT NULL
        );
        INSERT INTO user_settings_new (
          user_id,
          profile_details_public,
          updated_at
        )
        SELECT
          user_id,
          profile_details_public,
          updated_at
        FROM user_settings;
        DROP TABLE user_settings;
        ALTER TABLE user_settings_new RENAME TO user_settings;
      `);
    }

    if (!pinnedClearsIsCurrent) {
      sqlite.exec(`
        DROP TABLE IF EXISTS pinned_clears;
        CREATE TABLE pinned_clears (
          user_id INTEGER NOT NULL,
          course_id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          pinned_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, course_id)
        );
      `);
    }
  })();
}

function hasCurrentPinnedClearsShape(sqlite: BetterSqliteConnection) {
  const columns = sqlite.pragma("table_info(pinned_clears)") as Array<{
    name: string;
    pk: number;
  }>;
  if (
    columns.length !== 4 ||
    !["user_id", "course_id", "run_id", "pinned_at"].every((name) =>
      columns.some((column) => column.name === name),
    )
  ) {
    return false;
  }

  const primaryKeyColumns = columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  if (
    primaryKeyColumns.length !== 2 ||
    primaryKeyColumns[0] !== "user_id" ||
    primaryKeyColumns[1] !== "course_id"
  ) {
    return false;
  }

  const primaryKeyIndex = (
    sqlite.pragma("index_list(pinned_clears)") as Array<{
      name: string;
      origin: string;
    }>
  ).find((index) => index.origin === "pk");
  if (!primaryKeyIndex) {
    return false;
  }
  const indexedColumns = (
    sqlite.pragma(`index_info(${primaryKeyIndex.name})`) as Array<{
      seqno: number;
      name: string;
    }>
  )
    .sort((left, right) => left.seqno - right.seqno)
    .map((column) => column.name);
  if (
    indexedColumns.length !== 2 ||
    indexedColumns[0] !== "user_id" ||
    indexedColumns[1] !== "course_id"
  ) {
    return false;
  }

  const runForeignKey = (
    sqlite.pragma("foreign_key_list(pinned_clears)") as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>
  ).find((foreignKey) => foreignKey.from === "run_id");
  return (
    runForeignKey?.table === "runs" &&
    runForeignKey.to === "id" &&
    runForeignKey.on_delete.toUpperCase() === "CASCADE"
  );
}

function backfillCoursePassConditions(
  sqlite: BetterSqliteConnection,
  columns: string[],
) {
  if (!columns.includes("overall_pass_type")) {
    sqlite.exec("UPDATE courses SET overall_pass_conditions = COALESCE(overall_pass_conditions, '[]')");
    return;
  }

  const rows = sqlite
    .prepare(
      `
      SELECT id, overall_pass_type AS type, overall_pass_threshold AS threshold
      FROM courses
      WHERE overall_pass_conditions IS NULL
        OR overall_pass_type IS NOT NULL
      `,
    )
    .all() as Array<{ id: string; type: string | null; threshold: number | null }>;
  const update = sqlite.prepare(
    "UPDATE courses SET overall_pass_conditions = ? WHERE id = ?",
  );

  for (const row of rows) {
    const conditions =
      row.type === null || row.threshold === null
        ? []
        : [
            {
              type: row.type === "acc" ? "courseAccuracy" : "totalScore",
              threshold: row.threshold,
            },
          ];
    update.run(JSON.stringify(conditions), row.id);
  }
}

function backfillMapPassConditions(
  sqlite: BetterSqliteConnection,
  table: "beatmaps" | "map_results",
  columns: string[],
) {
  if (!columns.includes("pass_condition_type")) {
    sqlite.exec(`UPDATE ${table} SET pass_conditions = COALESCE(pass_conditions, '[]')`);
    return;
  }

  const rows = sqlite
    .prepare(
      `
      SELECT id, pass_condition_type AS type, pass_condition_threshold AS threshold
      FROM ${table}
      WHERE pass_conditions IS NULL
      `,
    )
    .all() as Array<{ id: string; type: string; threshold: number }>;
  const update = sqlite.prepare(`UPDATE ${table} SET pass_conditions = ? WHERE id = ?`);

  for (const row of rows) {
    update.run(
      JSON.stringify([
        {
          type: row.type === "acc" ? "accuracy" : "score",
          threshold: row.threshold,
        },
      ]),
      row.id,
    );
  }
}

function dropLegacyConditionColumns(
  sqlite: BetterSqliteConnection,
  table: "courses" | "beatmaps" | "map_results",
  columns: string[],
) {
  const existing = getColumnNames(sqlite, table);
  const legacyColumns = columns.filter((column) => existing.includes(column));
  if (legacyColumns.length === 0) {
    return;
  }

  try {
    for (const column of legacyColumns) {
      sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  } catch {
    rebuildConditionTable(sqlite, table);
  }
}

function rebuildConditionTable(
  sqlite: BetterSqliteConnection,
  table: "courses" | "beatmaps" | "map_results",
) {
  const previousForeignKeys = (
    sqlite.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }
  ).foreign_keys;
  sqlite.pragma("foreign_keys = OFF");

  try {
    sqlite.transaction(() => {
      if (table === "courses") {
        rebuildCoursesTable(sqlite);
      } else if (table === "beatmaps") {
        rebuildBeatmapsTable(sqlite);
      } else {
        rebuildMapResultsTable(sqlite);
      }
    })();
  } finally {
    sqlite.pragma(`foreign_keys = ${previousForeignKeys ? "ON" : "OFF"}`);
  }
}

function rebuildCoursesTable(sqlite: BetterSqliteConnection) {
  sqlite.exec(`
    CREATE TABLE courses_new (
      id TEXT PRIMARY KEY,
      dan_system_id TEXT NOT NULL REFERENCES dan_systems(id),
      creator_user_id INTEGER,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      ordinal INTEGER NOT NULL,
      score_model TEXT NOT NULL DEFAULT 'scorev2',
      overall_pass_conditions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(dan_system_id, slug)
    );
    INSERT INTO courses_new (
      id,
      dan_system_id,
      creator_user_id,
      name,
      slug,
      description,
      tags,
      ordinal,
      score_model,
      overall_pass_conditions,
      created_at,
      updated_at
    )
    SELECT
      id,
      dan_system_id,
      creator_user_id,
      name,
      slug,
      description,
      tags,
      ordinal,
      score_model,
      COALESCE(overall_pass_conditions, '[]'),
      COALESCE(created_at, unixepoch() * 1000),
      COALESCE(updated_at, unixepoch() * 1000)
    FROM courses;
    DROP TABLE courses;
    ALTER TABLE courses_new RENAME TO courses;
  `);
}

function rebuildBeatmapsTable(sqlite: BetterSqliteConnection) {
  sqlite.exec(`
    CREATE TABLE beatmaps_new (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id),
      beatmap_id INTEGER NOT NULL,
      mods TEXT NOT NULL,
      freemod INTEGER NOT NULL DEFAULT 0,
      pass_conditions TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      annotations TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO beatmaps_new (
      id,
      course_id,
      beatmap_id,
      mods,
      freemod,
      pass_conditions,
      ordinal,
      annotations
    )
    SELECT
      id,
      course_id,
      beatmap_id,
      mods,
      freemod,
      pass_conditions,
      ordinal,
      annotations
    FROM beatmaps;
    DROP TABLE beatmaps;
    ALTER TABLE beatmaps_new RENAME TO beatmaps;
  `);
}

function rebuildMapResultsTable(sqlite: BetterSqliteConnection) {
  sqlite.exec(`
    CREATE TABLE map_results_new (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      game_id INTEGER,
      beatmap_id INTEGER NOT NULL,
      mods TEXT NOT NULL,
      pass_conditions TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      score INTEGER NOT NULL,
      raw_score INTEGER NOT NULL DEFAULT 0,
      played_mods TEXT NOT NULL DEFAULT '',
      accuracy REAL NOT NULL,
      max_combo INTEGER NOT NULL,
      count_300 INTEGER NOT NULL,
      count_100 INTEGER NOT NULL,
      count_50 INTEGER NOT NULL,
      count_miss INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    INSERT INTO map_results_new (
      id,
      run_id,
      game_id,
      beatmap_id,
      mods,
      pass_conditions,
      ordinal,
      score,
      raw_score,
      played_mods,
      accuracy,
      max_combo,
      count_300,
      count_100,
      count_50,
      count_miss,
      passed,
      created_at
    )
    SELECT
      id,
      run_id,
      game_id,
      beatmap_id,
      mods,
      pass_conditions,
      ordinal,
      score,
      raw_score,
      played_mods,
      accuracy,
      max_combo,
      count_300,
      count_100,
      count_50,
      count_miss,
      passed,
      created_at
    FROM map_results;
    DROP TABLE map_results;
    ALTER TABLE map_results_new RENAME TO map_results;
  `);
}

function getColumnNames(sqlite: BetterSqliteConnection, table: string) {
  return (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(
    (col) => col.name,
  );
}

function ensureIndexes(sqlite: BetterSqliteConnection) {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS courses_system_ordinal_idx
      ON courses(dan_system_id, ordinal);

    CREATE INDEX IF NOT EXISTS beatmaps_course_ordinal_idx
      ON beatmaps(course_id, ordinal);

    CREATE INDEX IF NOT EXISTS runs_course_completed_idx
      ON runs(course_id, completed_at);

    CREATE INDEX IF NOT EXISTS runs_user_completed_idx
      ON runs(user_id, completed_at);

    CREATE INDEX IF NOT EXISTS map_results_run_ordinal_idx
      ON map_results(run_id, ordinal);

    CREATE INDEX IF NOT EXISTS oauth_states_expires_idx
      ON oauth_states(expires_at);

    CREATE INDEX IF NOT EXISTS sessions_expires_idx
      ON sessions(expires_at);

    CREATE INDEX IF NOT EXISTS pinned_clears_user_pinned_idx
      ON pinned_clears(user_id, pinned_at DESC);
  `);
}

function addColumnIfMissing(
  sqlite: BetterSqliteConnection,
  table: string,
  columns: string[],
  definition: string,
) {
  const [column] = definition.split(/\s+/, 1);
  if (!column) {
    throw new Error(`Invalid column definition for ${table}: ${definition}`);
  }

  if (!columns.includes(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    columns.push(column);
  }
}

function getSeedOptionsFromEnvironment(): SeedOptions {
  const apiKey = process.env["OSU_API_KEY"];

  return apiKey
    ? {
        resolveMetadata: (beatmapId) => fetchBeatmapMetadata(apiKey, beatmapId),
      }
    : {};
}
