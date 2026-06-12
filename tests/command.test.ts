import test from "node:test";
import assert from "node:assert/strict";
import { DOJO_USAGE_LINE, parseDojoCommand } from "@/bot/command";

test("parseDojoCommand parses valid start commands", () => {
  assert.deepEqual(parseDojoCommand("!dojo start test 1st"), {
    type: "start",
    systemNameKey: "test",
    courseNameKey: "1st",
  });
  assert.deepEqual(parseDojoCommand("  !Dojo   Start   FOO   bar  "), {
    type: "start",
    systemNameKey: "foo",
    courseNameKey: "bar",
  });
});

test("parseDojoCommand parses help and previous commands", () => {
  assert.deepEqual(parseDojoCommand("!dojo help"), { type: "help" });
  assert.deepEqual(parseDojoCommand("!DOJO HELP  "), { type: "help" });
  assert.deepEqual(parseDojoCommand("!dojo prev"), { type: "prev" });
  assert.deepEqual(parseDojoCommand("!DOJO PREV  "), { type: "prev" });
});

test("parseDojoCommand marks malformed dojo commands invalid", () => {
  assert.deepEqual(parseDojoCommand("!dojo"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo start"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo start onearg"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo unknownsub"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo start ABC! xyz"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo cancel"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand(`!dojo ${"draft"} test 1st`), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo abort"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo abort now"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo practice test 1st"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo skip"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!DOJO SKIP"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo skip map"), { type: "invalid" });
  assert.deepEqual(parseDojoCommand("!dojo stop"), { type: "invalid" });
});

test("parseDojoCommand ignores messages outside the dojo command boundary", () => {
  assert.equal(parseDojoCommand("!dojox foo"), null);
  assert.equal(parseDojoCommand("dojo start a b"), null);
  assert.equal(parseDojoCommand("hello !dojo"), null);
});

test("DOJO_USAGE_LINE mentions every supported command", () => {
  assert.match(DOJO_USAGE_LINE, /!dojo start <system-name> <course-name>/);
  assert.match(DOJO_USAGE_LINE, /!dojo prev/);
  assert.match(DOJO_USAGE_LINE, /!dojo help/);
  assert.match(DOJO_USAGE_LINE, /Ready/);
  assert.doesNotMatch(DOJO_USAGE_LINE, /skip/i);
  assert.doesNotMatch(DOJO_USAGE_LINE, /!dojo abort/);
  assert.doesNotMatch(DOJO_USAGE_LINE, new RegExp(`!dojo ${"draft"}`));
});
