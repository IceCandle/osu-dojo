import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAdjustedScore,
  rawTargetForAdjustedRemaining,
} from "@/lib/score";

test("computeAdjustedScore applies ScoreV2 mod multipliers", () => {
  assert.equal(computeAdjustedScore(1_000_000, []), 1_000_000);
  assert.equal(computeAdjustedScore(1_000_000, ["NF"]), 1_000_000);
  assert.equal(computeAdjustedScore(1_060_000, ["HD"]), 1_000_000);
  assert.equal(computeAdjustedScore(1_100_000, ["HR"]), 1_000_000);
  assert.equal(computeAdjustedScore(1_200_000, ["DT"]), 1_000_000);
  assert.equal(computeAdjustedScore(300_000, ["HT"]), 1_000_000);
  assert.equal(computeAdjustedScore(500_000, ["EZ"]), 1_000_000);
  assert.equal(computeAdjustedScore(900_000, ["SO"]), 1_000_000);
  assert.equal(computeAdjustedScore(1_166_000, ["HD", "HR"]), 1_000_000);
});

test("computeAdjustedScore treats unknown and unsupported tokens as identity", () => {
  assert.equal(
    computeAdjustedScore(1_000_000, ["UNKNOWN:123", "SV2", "MR", "K4"]),
    1_000_000,
  );
});

test("rawTargetForAdjustedRemaining returns exact minimum raw targets", () => {
  assertRawTarget(1_000_000, [], 1_000_000);
  assertRawTarget(1_000_000, ["HD", "HR"], 1_166_000);
  assertRawTarget(1_000_000, ["HT"], 300_000);
  assertRawTarget(1_000_001, ["HR"], 1_100_001);
});

function assertRawTarget(
  adjustedTarget: number,
  modTokens: readonly string[],
  expectedRawTarget: number,
) {
  const rawTarget = rawTargetForAdjustedRemaining(adjustedTarget, modTokens);

  assert.equal(rawTarget, expectedRawTarget);
  assert.ok(computeAdjustedScore(rawTarget, modTokens) >= adjustedTarget);
  assert.ok(computeAdjustedScore(rawTarget - 1, modTokens) < adjustedTarget);
}
