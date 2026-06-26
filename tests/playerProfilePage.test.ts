import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestDatabase } from "@/db/client";
import { getCourseByNameKey, storeCourseRunResult } from "@/db/queries";
import PlayerProfilePage from "@/app/players/[userId]/page";
import {
  createTempDatabaseUrl,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";
import { passRun } from "./helpers/runFixtures";

test("player profile page renders saved local runs", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    const databaseBundle = await createTestDatabase(temp.url);
    globalThis.__osuDojoDatabaseBundle = databaseBundle;
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      databaseBundle.db,
    );
    assert.ok(course);

    await storeCourseRunResult(passRun(77, "PagePlayer", course, 1_800_000_000_000), databaseBundle.db);

    const html = renderToStaticMarkup(
      await PlayerProfilePage({
        params: Promise.resolve({ userId: "77" }),
        searchParams: Promise.resolve({ mode: "osu" }),
      }),
    );

    assert.match(html, /PagePlayer/);
    assert.match(html, /https:\/\/osu\.ppy\.sh\/users\/77/);
    assert.match(html, /aria-label="PagePlayer&#x27;s osu! profile"/);
    assert.match(html, /Highest official dan/);
    assert.match(html, /Pinned clears/);
    assert.match(html, /Recent runs/);
    assert.match(html, /Most played courses/);
    assert.match(html, /role="tablist"/);
    assert.match(html, /aria-selected="true"[^>]*>osu/);
    assert.match(html, /class="status-pass"[^>]*>pass/);
    assert.match(
      html,
      /<time dateTime="2027-01-15T08:00:00.000Z">Jan 15, 2027, 8:00 AM<\/time>/,
    );
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("player profile page renders safe empty state for numeric no-runs users", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = await createTestDatabase(temp.url);

    const html = renderToStaticMarkup(
      await PlayerProfilePage({
        params: Promise.resolve({ userId: "888888" }),
        searchParams: Promise.resolve({}),
      }),
    );

    assert.match(html, /User 888888/);
    assert.match(html, /aria-label="User 888888 osu! profile"/);
    assert.match(html, /No saved runs/);
    assert.doesNotMatch(html, /undefined/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});

test("player profile page rejects non-numeric user ids", async () => {
  await assert.rejects(
    () =>
      PlayerProfilePage({
        params: Promise.resolve({ userId: "not-a-user" }),
        searchParams: Promise.resolve({}),
      }),
    (error) =>
      error instanceof Error &&
      (error.message === "NEXT_NOT_FOUND" ||
        ("digest" in error &&
          String(error.digest).includes("NEXT_HTTP_ERROR_FALLBACK;404"))),
  );
});

test("player profile mode tabs clamp unsupported modes to osu", async () => {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;

  try {
    process.env["DATABASE_URL"] = temp.url;
    globalThis.__osuDojoDatabaseBundle = await createTestDatabase(temp.url);

    const html = renderToStaticMarkup(
      await PlayerProfilePage({
        params: Promise.resolve({ userId: "888888" }),
        searchParams: Promise.resolve({ mode: "taiko" }),
      }),
    );

    assert.match(html, /role="tablist"/);
    assert.match(
      html,
      /<button aria-selected="true" class="course-tab is-active" role="tab" type="button">osu<\/button>/,
    );
    assert.match(
      html,
      /<button aria-selected="false" class="course-tab is-disabled" disabled="" role="tab" type="button">taiko<\/button>/,
    );
    assert.doesNotMatch(html, /aria-selected="true"[^>]*disabled/);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    temp.cleanup();
  }
});
