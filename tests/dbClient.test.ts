import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { createTempDatabaseUrl } from "./helpers/tempDatabase";

type SqliteConnection = Awaited<ReturnType<typeof createTestDatabase>>["sqlite"];

function getJournalMode(sqlite: SqliteConnection) {
  const rows = sqlite.pragma("journal_mode") as Array<{ journal_mode: string }>;
  return rows[0]?.journal_mode;
}

test("file-backed test databases use WAL journal mode", async () => {
  const temp = createTempDatabaseUrl("osudojo-wal-");

  try {
    const { sqlite } = await createTestDatabase(temp.url);
    try {
      assert.equal(getJournalMode(sqlite), "wal");
    } finally {
      sqlite.close();
    }
  } finally {
    temp.cleanup();
  }
});

test("in-memory test databases do not request WAL journal mode", async () => {
  const { sqlite } = await createTestDatabase(":memory:");

  try {
    assert.notEqual(getJournalMode(sqlite), "wal");
  } finally {
    sqlite.close();
  }
});
