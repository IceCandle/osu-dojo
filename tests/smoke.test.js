const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");

test("project scaffold exists", () => {
  assert.equal(existsSync("package.json"), true);
  assert.equal(existsSync("src/app/page.tsx"), true);
  assert.equal(existsSync("src/bot/index.ts"), true);
});
