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
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  dan_system_id TEXT NOT NULL REFERENCES dan_systems(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL,
  score_model TEXT NOT NULL DEFAULT 'scorev2',
  overall_pass_type TEXT,
  overall_pass_threshold REAL,
  UNIQUE(dan_system_id, slug)
);

CREATE TABLE IF NOT EXISTS beatmaps (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
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
  total_objects INTEGER CHECK (total_objects IS NULL OR total_objects >= 0),
  annotations TEXT NOT NULL DEFAULT '[]'
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

CREATE INDEX IF NOT EXISTS courses_system_ordinal_idx
  ON courses(dan_system_id, ordinal);

CREATE INDEX IF NOT EXISTS beatmaps_course_ordinal_idx
  ON beatmaps(course_id, ordinal);

CREATE INDEX IF NOT EXISTS runs_course_completed_idx
  ON runs(course_id, completed_at);

CREATE INDEX IF NOT EXISTS map_results_run_ordinal_idx
  ON map_results(run_id, ordinal);
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
  url = process.env.DATABASE_URL ?? "file:./dojo.db",
  seedOptions = getSeedOptionsFromEnvironment(),
): Promise<DatabaseBundle> {
  const sqlite = new Database(resolveDatabaseSource(url));
  sqlite.pragma("foreign_keys = ON");
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
  return initializeDatabaseBundle(url, { warnMissingObjectCounts: false });
}

function migrateDatabase(sqlite: BetterSqliteConnection) {
  const columns = (sqlite.pragma("table_info(beatmaps)") as Array<{ name: string }>)
    .map((col) => col.name);

  if (!columns.includes("total_objects")) {
    sqlite.exec(
      "ALTER TABLE beatmaps ADD COLUMN total_objects INTEGER CHECK (total_objects IS NULL OR total_objects >= 0)",
    );
  }
}

function getSeedOptionsFromEnvironment(): SeedOptions {
  const apiKey = process.env.OSU_API_KEY;

  return apiKey
    ? {
        resolveMetadata: (beatmapId) => fetchBeatmapMetadata(apiKey, beatmapId),
      }
    : {};
}
