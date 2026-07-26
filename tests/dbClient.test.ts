import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, getDatabase } from "@/db/client";
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

test("concurrent getDatabase calls share one local-only initialization", async () => {
  const temp = createTempDatabaseUrl("osudojo-init-");
  const previousUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;
  const previousPromise = globalThis.__osuDojoDatabaseBundlePromise;
  const previousFetch = globalThis.fetch;

  try {
    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = undefined;
    globalThis.__osuDojoDatabaseBundlePromise = undefined;
    globalThis.fetch = (() => {
      throw new Error("database initialization must not fetch");
    }) as typeof fetch;

    const databases = await Promise.all([
      getDatabase(),
      getDatabase(),
      getDatabase(),
    ]);
    assert.equal(databases[0], databases[1]);
    assert.equal(databases[1], databases[2]);
    const cachedBundle = globalThis.__osuDojoDatabaseBundle as
      | Awaited<ReturnType<typeof createTestDatabase>>
      | undefined;
    assert.equal(cachedBundle?.db, databases[0]);
    assert.equal(globalThis.__osuDojoDatabaseBundlePromise, undefined);
    databases[0]!.$client.close();
  } finally {
    if (previousUrl === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = previousUrl;
    }
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    globalThis.__osuDojoDatabaseBundlePromise = previousPromise;
    globalThis.fetch = previousFetch;
    temp.cleanup();
  }
});
