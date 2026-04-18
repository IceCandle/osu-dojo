import test from "node:test";
import assert from "node:assert/strict";
import {
  getActiveLobbyId,
  isNewLobbyCreated,
  parseDevTriggerArgs,
} from "@/bot/dev-trigger";

test("parseDevTriggerArgs opens a REPL without an initial command", () => {
  assert.deepEqual(parseDevTriggerArgs([]), { type: "repl" });
});

test("parseDevTriggerArgs accepts exactly a system and course", () => {
  assert.deepEqual(parseDevTriggerArgs(["test", "1st"]), {
    type: "start",
    systemNameKey: "test",
    courseNameKey: "1st",
  });
});

test("parseDevTriggerArgs rejects partial or extra arguments", () => {
  assert.deepEqual(parseDevTriggerArgs(["test"]), { type: "usage-error" });
  assert.deepEqual(parseDevTriggerArgs(["test", "1st", "extra"]), {
    type: "usage-error",
  });
});

test("getActiveLobbyId returns the current lobby id for a user", () => {
  const activeRunsByUserId = new Map([
    [42, { lobby: { id: 777 } }],
    [99, {}],
  ]);

  assert.equal(getActiveLobbyId(activeRunsByUserId, 42), 777);
  assert.equal(getActiveLobbyId(activeRunsByUserId, 99), undefined);
  assert.equal(getActiveLobbyId(activeRunsByUserId, 100), undefined);
});

test("isNewLobbyCreated only accepts a newly visible or changed lobby id", () => {
  assert.equal(isNewLobbyCreated(undefined, undefined), false);
  assert.equal(isNewLobbyCreated(777, undefined), false);
  assert.equal(isNewLobbyCreated(777, 777), false);
  assert.equal(isNewLobbyCreated(undefined, 777), true);
  assert.equal(isNewLobbyCreated(777, 778), true);
});
