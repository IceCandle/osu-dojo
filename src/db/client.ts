import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { seedDatabase } from "@/db/seed";

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

CREATE TABLE IF NOT EXISTS dans (
  id TEXT PRIMARY KEY,
  dan_system_id TEXT NOT NULL REFERENCES dan_systems(id),
  name TEXT NOT NULL,
  slug TEXT,
  course_slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL,
  score_model TEXT NOT NULL DEFAULT 'scorev2',
  overall_pass_type TEXT,
  overall_pass_threshold REAL,
  UNIQUE(dan_system_id, course_slug)
);

CREATE TABLE IF NOT EXISTS dan_beatmaps (
  id TEXT PRIMARY KEY,
  dan_id TEXT NOT NULL REFERENCES dans(id),
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

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  dan_id TEXT NOT NULL REFERENCES dans(id),
  passed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  match_id INTEGER
);

CREATE TABLE IF NOT EXISTS map_results (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES results(id),
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
): Promise<DatabaseBundle> {
  const sqlite = new Database(resolveDatabaseSource(url));
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES_SQL);
  migrateLegacySchema(sqlite);

  const db = drizzle(sqlite, { schema }) as AppDatabase;
  await seedDatabase(db);

  return { db, sqlite };
}

export async function getDatabase(): Promise<AppDatabase> {
  if (!globalThis.__osuDojoDatabaseBundle) {
    globalThis.__osuDojoDatabaseBundle = await initializeDatabaseBundle();
  }

  return globalThis.__osuDojoDatabaseBundle.db;
}

export async function createTestDatabase(url: string): Promise<DatabaseBundle> {
  return initializeDatabaseBundle(url);
}

function migrateLegacySchema(sqlite: BetterSqliteConnection) {
  const migrate = sqlite.transaction(() => {
    ensureColumn(sqlite, "dans", "course_slug", "TEXT");
    ensureColumn(sqlite, "dans", "score_model", "TEXT");
    ensureColumn(sqlite, "results", "match_id", "INTEGER");
    ensureColumn(sqlite, "map_results", "game_id", "INTEGER");
    ensureColumn(sqlite, "dan_beatmaps", "title", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, "dan_beatmaps", "artist", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, "dan_beatmaps", "difficulty_name", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, "dan_beatmaps", "mapper", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, "dan_beatmaps", "cover_url", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, "dan_beatmaps", "annotations", "TEXT NOT NULL DEFAULT '[]'");

    sqlite.prepare("UPDATE dans SET course_slug = slug WHERE course_slug IS NULL").run();
    sqlite
      .prepare("UPDATE dans SET score_model = 'scorev2' WHERE score_model IS NULL")
      .run();
    sqlite
      .prepare("UPDATE dans SET overall_pass_type = 'score' WHERE overall_pass_type = 'sv2'")
      .run();
    sqlite
      .prepare(
        "UPDATE dan_beatmaps SET pass_condition_type = 'score' WHERE pass_condition_type = 'sv2'",
      )
      .run();
    sqlite
      .prepare(
        "UPDATE map_results SET pass_condition_type = 'score' WHERE pass_condition_type = 'sv2'",
      )
      .run();
    sqlite.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS dans_system_course_unique ON dans(dan_system_id, course_slug)",
    ).run();
  });

  migrate();
}

function ensureColumn(
  sqlite: BetterSqliteConnection,
  tableName: string,
  columnName: string,
  definition: string,
) {
  const columns = sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}
