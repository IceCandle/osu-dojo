import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/db/client";
import {
  getCourseByNameKey,
  getPlayerProfile,
  getRankingForCourse,
  getRunPickerPage,
  getUserProfileSettings,
  hydratePinnedRuns,
  savePinnedClears,
  searchPlayers,
  setProfileDetailsPublic,
  SettingsValidationError,
  storeCourseRunResult,
} from "@/db/queries";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { POST as updateVisibility } from "@/app/api/settings/visibility/route";
import { POST as updatePinned } from "@/app/api/settings/pinned/route";
import { GET as listRuns } from "@/app/api/settings/runs/route";
import {
  createTempDatabaseUrl,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";
import { dnfRun, passRun } from "./helpers/runFixtures";

const SECRET = "osu-dojo-settings-test-secret-at-least-32-bytes";

test("profile visibility hides only detailed queries and preserves search and ranks", async () => {
  await withSettingsDatabase(async (db) => {
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.ok(course);
    await storeCourseRunResult(passRun(77, "VisiblePlayer", course, 1_800_000_000_000), db);
    await storeCourseRunResult(passRun(88, "OtherPlayer", course, 1_800_000_100_000), db);

    assert.deepEqual(await getUserProfileSettings(77, db), {
      profileDetailsPublic: true,
      pinnedMode: "auto",
    });
    const rankingBefore = await getRankingForCourse(course, db);
    const searchBefore = await searchPlayers("Visible", db);

    await setProfileDetailsPublic(77, false, db);
    const hidden = await getPlayerProfile(77, { viewerUserId: 88, db });
    assert.ok(hidden);
    assert.equal(hidden.detailsVisible, false);
    assert.equal("playCount" in hidden, false);

    const owner = await getPlayerProfile(77, { viewerUserId: 77, db });
    assert.ok(owner);
    assert.equal(owner.detailsVisible, true);
    const rankingAfter = await getRankingForCourse(course, db);
    assert.deepEqual(
      rankingAfter.results.map(({ id, rank, userId }) => ({ id, rank, userId })),
      rankingBefore.results.map(({ id, rank, userId }) => ({ id, rank, userId })),
    );
    assert.deepEqual(await searchPlayers("Visible", db), searchBefore);

    await setProfileDetailsPublic(77, true, db);
    const restored = await getPlayerProfile(77, { viewerUserId: 88, db });
    assert.ok(restored);
    assert.equal(restored.detailsVisible, true);
  });
});

test("hidden non-owner profiles do not execute map-backed detail queries", async () => {
  await withSettingsDatabase(async (db) => {
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.ok(course);
    await storeCourseRunResult(passRun(77, "HiddenPlayer", course, 1_800_000_000_000), db);
    await setProfileDetailsPublic(77, false, db);
    db.$client.exec("DROP TABLE map_results");

    const profile = await getPlayerProfile(77, { viewerUserId: 88, db });
    assert.ok(profile);
    assert.equal(profile.detailsVisible, false);
    assert.equal(profile.username, "HiddenPlayer");
  });
});

test("manual pinned clears enforce ownership/pass/duplicates and preserve order", async () => {
  await withSettingsDatabase(async (db) => {
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.ok(course);
    const first = await storeCourseRunResult(
      passRun(77, "PinPlayer", course, 1_800_000_000_000),
      db,
    );
    const second = await storeCourseRunResult(
      passRun(77, "PinPlayer", course, 1_800_000_100_000),
      db,
    );
    const failed = await storeCourseRunResult(
      dnfRun(77, "PinPlayer", course, 1_800_000_200_000),
      db,
    );
    const other = await storeCourseRunResult(
      passRun(88, "OtherPlayer", course, 1_800_000_300_000),
      db,
    );
    const extraPasses: Awaited<
      ReturnType<typeof storeCourseRunResult>
    >[] = [];
    for (let index = 0; index < 4; index += 1) {
      extraPasses.push(
        await storeCourseRunResult(
          passRun(
            77,
            "PinPlayer",
            course,
            1_800_000_400_000 + index,
          ),
          db,
        ),
      );
    }

    const saved = await savePinnedClears(
      77,
      { mode: "manual", runIds: [first.run.id, second.run.id] },
      db,
    );
    assert.equal(saved.mode, "manual");
    assert.deepEqual(
      saved.pinned.map((run) => run.runId),
      [first.run.id, second.run.id],
    );
    assert.ok(saved.pinned.every((run) => !("rank" in run)));
    assert.deepEqual(
      (await hydratePinnedRuns(77, [second.run.id, first.run.id], db)).map(
        (run) => run.runId,
      ),
      [second.run.id, first.run.id],
    );

    await assert.rejects(
      () =>
        savePinnedClears(
          77,
          {
            mode: "manual",
            runIds: [
              first.run.id,
              second.run.id,
              ...extraPasses.map((result) => result.run.id),
            ],
          },
          db,
        ),
      SettingsValidationError,
    );
    await assert.rejects(
      () =>
        savePinnedClears(
          77,
          { mode: "manual", runIds: [first.run.id, first.run.id] },
          db,
        ),
      SettingsValidationError,
    );
    for (const runId of [failed.run.id, other.run.id, "missing"]) {
      await assert.rejects(
        () => savePinnedClears(77, { mode: "manual", runIds: [runId] }, db),
        SettingsValidationError,
      );
    }

    const directInsert = db.$client.prepare(
      "INSERT INTO pinned_clears (user_id, run_id, ordinal) VALUES (?, ?, ?)",
    );
    assert.throws(() => directInsert.run(77, first.run.id, 2));
    assert.throws(() => directInsert.run(77, extraPasses[0]!.run.id, 0));
    assert.throws(() => directInsert.run(77, extraPasses[0]!.run.id, 5));

    const empty = await savePinnedClears(
      77,
      { mode: "manual", runIds: [] },
      db,
    );
    assert.deepEqual(empty.pinned, []);
    const automatic = await savePinnedClears(77, { mode: "auto" }, db);
    assert.equal(automatic.mode, "auto");
    assert.ok(automatic.pinned.length > 0);

    await savePinnedClears(
      77,
      { mode: "manual", runIds: [first.run.id] },
      db,
    );
    db.$client
      .prepare("DELETE FROM map_results WHERE run_id = ?")
      .run(first.run.id);
    db.$client.prepare("DELETE FROM runs WHERE id = ?").run(first.run.id);
    const pinCount = db.$client
      .prepare("SELECT COUNT(*) AS count FROM pinned_clears WHERE user_id = ?")
      .get(77) as { count: number };
    assert.equal(pinCount.count, 0);
  });
});

test("run picker uses 20-row keyset pages and rejects malformed cursors", async () => {
  await withSettingsDatabase(async (db) => {
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.ok(course);
    for (let index = 0; index < 21; index += 1) {
      await storeCourseRunResult(
        passRun(77, "PickerPlayer", course, 1_800_000_000_000 + index),
        db,
      );
    }
    const first = await getRunPickerPage(77, null, db);
    assert.equal(first.runs.length, 20);
    assert.ok(first.nextCursor);
    const second = await getRunPickerPage(77, first.nextCursor, db);
    assert.equal(second.runs.length, 1);
    assert.equal(second.nextCursor, null);
    assert.notEqual(first.runs.at(-1)?.runId, second.runs[0]?.runId);
    await assert.rejects(
      () => getRunPickerPage(77, "not-a-cursor", db),
      SettingsValidationError,
    );
  });
});

test("settings routes require origin/session and return private no-store responses", async () => {
  await withSettingsDatabase(async (db) => {
    db.$client
      .prepare(
        "INSERT INTO users (osu_user_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(77, "SettingsPlayer", 1, 1);
    const token = await createSession(77, db);
    const cookie = `${SESSION_COOKIE_NAME}=${token}`;

    const forbidden = await updateVisibility(
      jsonRequest("/api/settings/visibility", { profileDetailsPublic: false }, {
        cookie,
      }),
    );
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get("cache-control"), "private, no-store");

    const unauthorized = await updateVisibility(
      jsonRequest(
        "/api/settings/visibility",
        { profileDetailsPublic: false },
        { origin: "http://127.0.0.1:3100" },
      ),
    );
    assert.equal(unauthorized.status, 401);

    const updated = await updateVisibility(
      jsonRequest(
        "/api/settings/visibility",
        { profileDetailsPublic: false },
        { cookie, origin: "http://127.0.0.1:3100" },
      ),
    );
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { profileDetailsPublic: false });

    const pinned = await updatePinned(
      jsonRequest(
        "/api/settings/pinned",
        { mode: "manual", runIds: [] },
        { cookie, origin: "http://127.0.0.1:3100" },
      ),
    );
    assert.equal(pinned.status, 200);
    assert.deepEqual(await pinned.json(), { mode: "manual", pinned: [] });

    const runs = await listRuns(
      new Request("http://127.0.0.1:3100/api/settings/runs", {
        headers: { cookie },
      }),
    );
    assert.equal(runs.status, 200);
    assert.equal(runs.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await runs.json(), { runs: [], nextCursor: null });
  });
});

function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string>,
) {
  return new Request(`http://127.0.0.1:3100${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withSettingsDatabase(
  callbackFn: (db: Awaited<ReturnType<typeof createTestDatabase>>["db"]) => Promise<void>,
) {
  const temp = createTempDatabaseUrl();
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  const previousBundle = globalThis.__osuDojoDatabaseBundle;
  const previousEnv = {
    SESSION_SECRET: process.env["SESSION_SECRET"],
    DOJO_SITE_URL: process.env["DOJO_SITE_URL"],
    DOJO_E2E_AUTH: process.env["DOJO_E2E_AUTH"],
  };
  try {
    process.env["SESSION_SECRET"] = SECRET;
    process.env["DOJO_SITE_URL"] = "http://127.0.0.1:3100";
    process.env["DOJO_E2E_AUTH"] = "1";
    process.env["DATABASE_URL"] = temp.url;
    const bundle = await createTestDatabase(temp.url);
    globalThis.__osuDojoDatabaseBundle = bundle;
    await callbackFn(bundle.db);
  } finally {
    process.env["DATABASE_URL"] = previousDatabaseUrl;
    globalThis.__osuDojoDatabaseBundle = previousBundle;
    restoreEnv("SESSION_SECRET", previousEnv.SESSION_SECRET);
    restoreEnv("DOJO_SITE_URL", previousEnv.DOJO_SITE_URL);
    restoreEnv("DOJO_E2E_AUTH", previousEnv.DOJO_E2E_AUTH);
    temp.cleanup();
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
