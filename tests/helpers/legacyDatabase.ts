import assert from "node:assert/strict";
import Database from "better-sqlite3";

type BetterSqliteConnection = InstanceType<typeof Database>;

export interface LegacyCourseRow {
  id: string;
  danSystemId: string;
  creatorUserId: number | null;
  name: string;
  slug: string;
  description: string;
  tags: string;
  ordinal: number;
  official: number;
  label: string | null;
  scoreModel: string;
  overallPassType: string | null;
  overallPassThreshold: number | null;
  overallPassConditions: string;
  createdAt: number;
  updatedAt: number;
}

type CourseRow = Record<string, unknown> & { id: string };

export function createLegacyCoursesDatabase(
  url: string,
  rows: LegacyCourseRow[],
): BetterSqliteConnection {
  const sqlite = new Database(resolveDatabaseSource(url));
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE dan_systems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'current',
      ladder TEXT,
      ladder_order INTEGER NOT NULL DEFAULT 0
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
      official INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      score_model TEXT NOT NULL DEFAULT 'scorev2',
      overall_pass_type TEXT,
      overall_pass_threshold REAL,
      overall_pass_conditions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(dan_system_id, slug)
    );

    CREATE INDEX legacy_overall_pass_type_idx
      ON courses(overall_pass_type);
  `);

  const insertSystem = sqlite.prepare(`
    INSERT INTO dan_systems (
      id,
      name,
      slug,
      description,
      status,
      ladder,
      ladder_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const systemIds = new Set(rows.map((row) => row.danSystemId));
  for (const systemId of systemIds) {
    insertSystem.run(
      systemId,
      `Legacy ${systemId}`,
      `legacy-${systemId}`,
      "Legacy migration fixture",
      "current",
      null,
      0,
    );
  }

  const insertCourse = sqlite.prepare(`
    INSERT INTO courses (
      id,
      dan_system_id,
      creator_user_id,
      name,
      slug,
      description,
      tags,
      ordinal,
      official,
      label,
      score_model,
      overall_pass_type,
      overall_pass_threshold,
      overall_pass_conditions,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insertCourse.run(
      row.id,
      row.danSystemId,
      row.creatorUserId,
      row.name,
      row.slug,
      row.description,
      row.tags,
      row.ordinal,
      row.official,
      row.label,
      row.scoreModel,
      row.overallPassType,
      row.overallPassThreshold,
      row.overallPassConditions,
      row.createdAt,
      row.updatedAt,
    );
  }

  return sqlite;
}

export function readCourseRows(
  sqlite: BetterSqliteConnection,
  ids: string[],
): Record<string, CourseRow> {
  const select = sqlite.prepare("SELECT * FROM courses WHERE id = ?");
  return Object.fromEntries(
    ids.map((id) => {
      const row = select.get(id) as CourseRow | undefined;
      assert.ok(row, `Expected course ${id} to exist`);
      return [id, row];
    }),
  );
}

export function assertCourseColumnsPreserved(
  before: Record<string, CourseRow>,
  after: Record<string, CourseRow>,
  options: { retiredColumns: string[] },
) {
  const retiredColumns = new Set(options.retiredColumns);

  for (const [id, beforeRow] of Object.entries(before)) {
    const afterRow = after[id];
    assert.ok(afterRow, `Expected course ${id} to survive the migration`);

    for (const [column, value] of Object.entries(beforeRow)) {
      if (!retiredColumns.has(column)) {
        assert.ok(column in afterRow, `Expected course ${id} to keep column ${column}`);
        assert.deepEqual(
          afterRow[column],
          value,
          `Expected course ${id} column ${column} to keep its value`,
        );
      }
    }

    for (const column of retiredColumns) {
      assert.equal(
        column in afterRow,
        false,
        `Expected retired course column ${column} to be removed`,
      );
    }
  }
}

function resolveDatabaseSource(url: string) {
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}
