import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SearchOverlay from "@/app/SearchOverlay";

test("SearchOverlay renders the closed header trigger", () => {
  const html = renderToStaticMarkup(React.createElement(SearchOverlay));

  assert.match(html, /aria-label="Search"/);
  assert.match(html, /Search/);
  assert.doesNotMatch(html, /role="dialog"/);
});
