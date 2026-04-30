import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScoreSV2 } from "@/lib/score";

test("normalizeScoreSV2 keeps nomod and NF scores unchanged", () => {
  assert.equal(normalizeScoreSV2(900000, []), 900000);
  assert.equal(normalizeScoreSV2(900000, ["NF"]), 900000);
});

test("normalizeScoreSV2 divides player-selected reading mods out of raw score", () => {
  assert.equal(normalizeScoreSV2(1_060_000, ["HD"]), 1_000_000);
  assert.equal(normalizeScoreSV2(1_166_000, ["HD", "HR"]), 1_000_000);
});

test("normalizeScoreSV2 divides forced course mods and player mods together", () => {
  assert.equal(normalizeScoreSV2(1_166_000, ["HD", "HR"]), 1_000_000);
  assert.equal(normalizeScoreSV2(300_000, ["HT"]), 1_000_000);
});

test("normalizeScoreSV2 treats unknown tokens as identity", () => {
  assert.equal(normalizeScoreSV2(900000, ["UNKNOWN:2147483648"]), 900000);
});
