import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDateTime,
  formatConditionCompact,
  formatConditionCompactAscii,
  formatUtcDateTime,
} from "@/lib/format";

test("date-time formatting shares the same medium date and short time styles", () => {
  const value = Date.UTC(2027, 0, 15, 8);

  assert.equal(formatUtcDateTime(value), "Jan 15, 2027, 8:00 AM");
  assert.equal(
    formatDateTime(value, { locale: "en-US", timeZone: "UTC" }),
    formatUtcDateTime(value),
  );
});

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
