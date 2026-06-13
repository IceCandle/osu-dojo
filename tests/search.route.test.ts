import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import { GET } from "@/app/api/search/route";
import { createTempDatabaseUrl } from "./helpers/dbFixtures";

test("GET /api/search returns catalog search results from the configured database", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = await createTestDatabase(temp.url);

    const response = await GET(new Request("http://x/api/search?q=1st"));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      systems: [],
      courses: [
        {
          name: "1st",
          nameKey: "1st",
          systemName: "test",
          systemNameKey: "test",
        },
      ],
      players: [],
    });
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("GET /api/search returns empty results for blank and over-length queries", async () => {
  const blank = await GET(new Request("http://x/api/search?q=%20%20"));
  const long = await GET(new Request(`http://x/api/search?q=${"a".repeat(101)}`));

  assert.deepEqual(await blank.json(), { systems: [], courses: [], players: [] });
  assert.deepEqual(await long.json(), { systems: [], courses: [], players: [] });
});
