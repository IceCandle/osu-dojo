import test from "node:test";
import assert from "node:assert/strict";
import {
  formatModsCanonical,
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
