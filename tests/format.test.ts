import test from "node:test";
import assert from "node:assert/strict";
import {
  formatConditionCompact,
  formatConditionCompactAscii,
} from "@/lib/format";

test("formatConditionCompact renders miss thresholds as web-friendly upper bounds", () => {
  assert.equal(formatConditionCompact({ type: "missCount", threshold: 10 }), "10- miss");
  assert.equal(
    formatConditionCompact({ type: "totalMissCount", threshold: 10 }),
    "10- miss",
  );
});

test("formatConditionCompactAscii preserves inequality miss thresholds", () => {
  assert.equal(
    formatConditionCompactAscii({ type: "missCount", threshold: 10 }),
    "<=10 miss",
  );
  assert.equal(
    formatConditionCompactAscii({ type: "totalMissCount", threshold: 10 }),
    "<=10 miss",
  );
});
