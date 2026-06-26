import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidQuery,
  MAX_QUERY_LENGTH,
  normalizeSearch,
  parseCatalogFilters,
} from "@/lib/search";
import { kebabizeName } from "@/lib/format";

test("normalizeSearch folds case and internal whitespace without kebabizing", () => {
  assert.equal(normalizeSearch("  Test   Stage\tOne  "), "test stage one");
  assert.equal(kebabizeName("  Test   Stage One  "), "test-stage-one");
});

test("isValidQuery rejects blank and over-length queries", () => {
  assert.equal(isValidQuery("test"), true);
  assert.equal(isValidQuery("   "), false);
  assert.equal(isValidQuery("a".repeat(MAX_QUERY_LENGTH)), true);
  assert.equal(isValidQuery("a".repeat(MAX_QUERY_LENGTH + 1)), false);
});

test("parseCatalogFilters normalizes official params", () => {
  assert.deepEqual(
    parseCatalogFilters(new URLSearchParams("official=1&ladder=main-dan")),
    { officialOnly: true },
  );
  assert.deepEqual(
    parseCatalogFilters(new URLSearchParams("official=true")),
    { officialOnly: true },
  );
  assert.deepEqual(
    parseCatalogFilters(new URLSearchParams("official=yes&ladder=__bad__")),
    { officialOnly: false },
  );
});
