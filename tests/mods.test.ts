import test from "node:test";
import assert from "node:assert/strict";
import {
  formatModsCanonical,
  formatVisibleCourseMods,
  formatVisibleCourseModTokens,
  parseModBitmask,
  validateFreemodPlayerSelection,
} from "@/lib/mods";

test("parseModBitmask returns no tokens for no-mod values", () => {
  assert.deepEqual(parseModBitmask(0), []);
  assert.deepEqual(parseModBitmask(null), []);
  assert.deepEqual(parseModBitmask(undefined), []);
});

test("parseModBitmask maps known bits to canonical tokens", () => {
  assert.deepEqual(parseModBitmask(8), ["HD"]);
  assert.deepEqual(parseModBitmask(72), ["HD", "DT"]);
  assert.deepEqual(parseModBitmask(576), ["NC"]);
  assert.deepEqual(parseModBitmask(2097152), ["RN"]);
});

test("parseModBitmask surfaces future unknown bits", () => {
  assert.deepEqual(parseModBitmask(2147483648), ["UNKNOWN:2147483648"]);
});

test("formatModsCanonical sorts and dedupes atomic tokens", () => {
  assert.equal(formatModsCanonical(["HR", "HD", "HD"]), "HDHR");
});

test("formatVisibleCourseModTokens returns visible canonical tokens", () => {
  assert.deepEqual(formatVisibleCourseModTokens(""), []);
  assert.deepEqual(formatVisibleCourseModTokens("HD"), ["HD"]);
  assert.deepEqual(formatVisibleCourseModTokens("HDHR"), ["HD", "HR"]);
  assert.deepEqual(formatVisibleCourseModTokens("HDNF"), ["HD"]);
});

test("formatVisibleCourseMods keeps the existing joined display contract", () => {
  assert.equal(formatVisibleCourseMods(""), "NM");
  assert.equal(formatVisibleCourseMods("HD"), "HD");
  assert.equal(formatVisibleCourseMods("HDHR"), "HDHR");
  assert.equal(formatVisibleCourseMods("HDNF"), "HD");
});

test("validateFreemodPlayerSelection accepts HD and HR only", () => {
  assert.deepEqual(validateFreemodPlayerSelection(["HD"]), { ok: true });
  assert.deepEqual(validateFreemodPlayerSelection(["HD", "HR"]), { ok: true });
  assert.deepEqual(validateFreemodPlayerSelection(["EZ"]), {
    ok: false,
    rejected: ["EZ"],
  });
  assert.deepEqual(validateFreemodPlayerSelection(["HD", "FL"]), {
    ok: false,
    rejected: ["FL"],
  });
});
