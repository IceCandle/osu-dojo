import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTestDatabase, type AppDatabase } from "@/db/client";
import {
  getCourseByNameKey,
  getPlayerProfile,
  getRankingForCourse,
  getUserProfileSettings,
  PinLimitError,
  searchPlayers,
  setProfileDetailsPublic,
  SettingsValidationError,
  storeCourseRunResult,
  updatePinnedClear,
} from "@/db/queries";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { POST as updateVisibility } from "@/app/api/settings/visibility/route";
import { POST as updatePinned } from "@/app/api/settings/pinned/route";
import {
  createTempDatabaseUrl,
  SEEDED_COURSE_NAME_KEY,
  SEEDED_SYSTEM_NAME_KEY,
} from "./helpers/dbFixtures";
import { passRun } from "./helpers/runFixtures";

const SECRET = "osu-dojo-settings-test-secret-at-least-32-bytes";

test("profile visibility hides only details and preserves search and ranks", async () => {
  await withSettingsDatabase(async (db) => {
    const course = await getCourseByNameKey(
      SEEDED_SYSTEM_NAME_KEY,
      SEEDED_COURSE_NAME_KEY,
      db,
    );
    assert.ok(course);
    await storeCourseRunResult(
      passRun(77, "VisiblePlayer", course, 1_800_000_000_000),
      db,
    );
    await storeCourseRunResult(
      passRun(88, "OtherPlayer", course, 1_800_000_100_000),
      db,
    );

    assert.deepEqual(await getUserProfileSettings(77, db), {
      profileDetailsPublic: true,
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
      rankingAfter.results.map(({ id, rank, userId }) => ({
        id,
        rank,
        userId,
      })),
      rankingBefore.results.map(({ id, rank, userId }) => ({
        id,
        rank,
        userId,
      })),
    );
    assert.deepEqual(await searchPlayers("Visible", db), searchBefore);
  });
});

test("course pins validate ownership and pass state, replace, unpin, cap, sort, and cascade", async () => {
  await withSettingsDatabase(async (db) => {
    const runIds = seedPinRuns(db, 77, 7);
    const otherRun = seedPinRuns(db, 88, 1, "other")[0]!;
    db.$client
      .prepare("UPDATE runs SET passed = 0 WHERE id = ?")
      .run(runIds[6]);

    for (const invalidRunId of ["missing", otherRun, runIds[6]!]) {
      await assert.rejects(
        () =>
          updatePinnedClear(
            77,
            { runId: invalidRunId, pinned: true },
            db,
          ),
        SettingsValidationError,
      );
    }

    for (let index = 0; index < 5; index += 1) {
      await updatePinnedClear(
        77,
        { runId: runIds[index]!, pinned: true },
        db,
        100 + index,
      );
    }
    await assert.rejects(
      () =>
        updatePinnedClear(77, { runId: runIds[5]!, pinned: true }, db, 200),
      PinLimitError,
    );

    const replacement = seedPinRuns(db, 77, 1, "replacement", "pin-course-0")[0]!;
    await updatePinnedClear(
      77,
      { runId: replacement, pinned: true },
      db,
      300,
    );
    const storedReplacement = db.$client
      .prepare(
        "SELECT run_id AS runId, pinned_at AS pinnedAt FROM pinned_clears WHERE user_id = 77 AND course_id = 'pin-course-0'",
      )
      .get();
    assert.deepEqual(storedReplacement, {
      runId: replacement,
      pinnedAt: 300,
    });

    const profile = await getPlayerProfile(77, { db });
    assert.ok(profile?.detailsVisible);
    if (!profile?.detailsVisible) {
      assert.fail("Expected visible profile.");
    }
    assert.equal(profile.pinnedClears[0]?.runId, replacement);
    assert.ok(profile.pinnedClears.every((clear) => !("ordinal" in clear)));

    await updatePinnedClear(
      77,
      { runId: replacement, pinned: false },
      db,
    );
    await updatePinnedClear(
      77,
      { runId: replacement, pinned: false },
      db,
    );
    const afterUnpin = db.$client
      .prepare(
        "SELECT COUNT(*) AS count FROM pinned_clears WHERE user_id = 77",
      )
      .get() as { count: number };
    assert.equal(afterUnpin.count, 4);

    await updatePinnedClear(
      77,
      { runId: runIds[5]!, pinned: true },
      db,
    );
    db.$client.prepare("DELETE FROM runs WHERE id = ?").run(runIds[5]);
    const afterCascade = db.$client
      .prepare(
        "SELECT COUNT(*) AS count FROM pinned_clears WHERE user_id = 77",
      )
      .get() as { count: number };
    assert.equal(afterCascade.count, 4);
  });
});

test("pin route checks session before Origin and returns private no-store statuses", async () => {
  await withSettingsDatabase(async (db) => {
    const runId = seedPinRuns(db, 77, 1)[0]!;
    const token = await createSession(77, db);
    const cookie = `${SESSION_COOKIE_NAME}=${token}`;

    const unauthenticated = await updatePinned(
      jsonRequest("/api/settings/pinned", { runId, pinned: true }, {}),
    );
    assert.equal(unauthenticated.status, 401);

    const forbidden = await updatePinned(
      jsonRequest(
        "/api/settings/pinned",
        { runId, pinned: true },
        { cookie },
      ),
    );
    assert.equal(forbidden.status, 403);

    const invalid = await updatePinned(
      jsonRequest(
        "/api/settings/pinned",
        { runId: "missing", pinned: true },
        { cookie, origin: "http://127.0.0.1:3100" },
      ),
    );
    assert.equal(invalid.status, 400);

    const pinned = await updatePinned(
      jsonRequest(
        "/api/settings/pinned",
        { runId, pinned: true },
        { cookie, origin: "http://127.0.0.1:3100" },
      ),
    );
    assert.equal(pinned.status, 200);
    assert.equal(pinned.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await pinned.json(), {
      runId,
      courseId: "pin-course-0",
      pinned: true,
    });

    const visibility = await updateVisibility(
      jsonRequest(
        "/api/settings/visibility",
        { profileDetailsPublic: false },
        { cookie, origin: "http://127.0.0.1:3100" },
      ),
    );
    assert.equal(visibility.status, 200);
    assert.equal(visibility.headers.get("cache-control"), "private, no-store");
  });
});

test("separate worker connections keep concurrent course pins within the cap", async () => {
  const temp = createTempDatabaseUrl();
  try {
    const bundle = await createTestDatabase(temp.url);
    const runIds = seedPinRuns(bundle.db, 77, 7);

    const sameCourseReplacement = seedPinRuns(
      bundle.db,
      77,
      1,
      "same-course",
      "pin-course-0",
    )[0]!;
    const sameCourseResults = await runConcurrentPins(
      temp.url,
      runIds[0]!,
      sameCourseReplacement,
    );
    assert.deepEqual(
      sameCourseResults.map((result) => result.type),
      ["result", "result"],
    );
    assert.equal(
      (
        bundle.db.$client
          .prepare(
            "SELECT COUNT(*) AS count FROM pinned_clears WHERE user_id = 77",
          )
          .get() as { count: number }
      ).count,
      1,
    );

    bundle.db.$client
      .prepare("DELETE FROM pinned_clears WHERE user_id = 77")
      .run();
    for (let index = 0; index < 4; index += 1) {
      await updatePinnedClear(
        77,
        { runId: runIds[index]!, pinned: true },
        bundle.db,
        index,
      );
    }

    const competing = await runConcurrentPins(
      temp.url,
      runIds[4]!,
      runIds[5]!,
    );
    assert.equal(
      competing.filter((result) => result.type === "result").length,
      1,
    );
    assert.equal(
      competing.filter(
        (result) => result.type === "error" && result.name === "PinLimitError",
      ).length,
      1,
    );
    assert.equal(
      (
        bundle.db.$client
          .prepare(
            "SELECT COUNT(*) AS count FROM pinned_clears WHERE user_id = 77",
          )
          .get() as { count: number }
      ).count,
      5,
    );
  } finally {
    temp.cleanup();
  }
});

function seedPinRuns(
  db: AppDatabase,
  userId: number,
  count: number,
  prefix = "pin",
  fixedCourseId?: string,
) {
  db.$client
    .prepare(
      `INSERT OR IGNORE INTO dan_systems (
         id, name, slug, description, status, ladder, ladder_order
       ) VALUES ('pin-system', 'pin system', 'pin-system', '', 'draft', NULL, 0)`,
    )
    .run();
  db.$client
    .prepare(
      `INSERT INTO users (osu_user_id, username, created_at, updated_at)
       VALUES (?, ?, 1, 1)
       ON CONFLICT(osu_user_id) DO NOTHING`,
    )
    .run(userId, `Player${userId}`);
  const insertCourse = db.$client.prepare(
    `INSERT OR IGNORE INTO courses (
       id, dan_system_id, name, slug, description, ordinal, official,
       score_model, overall_pass_conditions, created_at, updated_at
     ) VALUES (?, 'pin-system', ?, ?, '', ?, 0, 'scorev2', '[]', 1, 1)`,
  );
  const insertRun = db.$client.prepare(
    `INSERT INTO runs (
       id, user_id, username, course_id, passed, started_at, completed_at, match_id
     ) VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
  );
  return Array.from({ length: count }, (_, index) => {
    const courseId = fixedCourseId ?? `pin-course-${index}`;
    const runId = `${prefix}-run-${index}`;
    insertCourse.run(courseId, `Pin Course ${index}`, courseId, index + 1);
    insertRun.run(
      runId,
      userId,
      `Player${userId}`,
      courseId,
      10 + index,
      20 + index,
    );
    return runId;
  });
}

type PinProcessResult =
  | { type: "result"; result: unknown }
  | { type: "error"; name: string; message: string };

type PinProcessMessage =
  | { type: "ready" }
  | { type: "result"; result: PinProcessResult }
  | { type: "error"; name: string; message: string };

const pinProcessPath = fileURLToPath(new URL("./helpers/pinProcess.ts", import.meta.url));

async function runConcurrentPins(
  databaseUrl: string,
  firstRunId: string,
  secondRunId: string,
): Promise<PinProcessResult[]> {
  const children: ChildProcess[] = [];
  try {
    for (const [index, runId] of [firstRunId, secondRunId].entries()) {
      const child = fork(pinProcessPath, [databaseUrl, "77", runId, String(1_000 + index)], {
        execArgv: ["--import", "tsx"],
      });
      children.push(child);
      await waitForPinProcessMessage(child, "ready");
    }

    const results = children.map((child) => waitForPinProcessMessage(child, "result"));
    for (const child of children) {
      child.send({ type: "start" });
    }
    return (await Promise.all(results)).map((message) => message.result);
  } finally {
    terminatePinProcesses(children);
  }
}

function waitForPinProcessMessage<T extends PinProcessMessage["type"]>(
  child: ChildProcess,
  expectedType: T,
): Promise<Extract<PinProcessMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(new Error(`Pin process timed out while waiting for ${expectedType}.`));
    }, 10_000);

    function finish(error?: Error, message?: Extract<PinProcessMessage, { type: T }>) {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
      if (error) {
        reject(error);
      } else if (message) {
        resolve(message);
      }
    }

    function onError(error: Error) {
      finish(error);
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      finish(
        new Error(
          `Pin process exited before ${expectedType}: code=${code ?? "null"} signal=${signal ?? "null"}.`,
        ),
      );
    }

    function onMessage(message: unknown) {
      if (!isPinProcessMessage(message)) return;
      if (message.type === "error") {
        finish(new Error(`${message.name}: ${message.message}`));
      } else if (message.type === expectedType) {
        finish(undefined, message as Extract<PinProcessMessage, { type: T }>);
      }
    }

    child.on("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

function isPinProcessMessage(message: unknown): message is PinProcessMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message.type === "ready" || message.type === "result" || message.type === "error")
  );
}

function terminatePinProcesses(children: ChildProcess[]) {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }
}

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
  callbackFn: (db: AppDatabase) => Promise<void>,
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
