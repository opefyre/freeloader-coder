import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalStudioUrl,
  routeForView,
  studioViews,
  viewFromLocation
} from "../apps/studio/src/routing.js";

test("every Studio view has a stable clean route", () => {
  assert.deepEqual(
    studioViews.map((view) => [view, routeForView(view)]),
    [
      ["overview", "/"],
      ["projects", "/projects"],
      ["conversation", "/conversation"],
      ["work", "/work"],
      ["providers", "/providers"],
      ["integrations", "/integrations"],
      ["evidence", "/evidence"],
      ["help", "/help"],
      ["releases", "/releases"],
      ["trust", "/trust"],
      ["accessibility", "/accessibility"],
      ["settings", "/settings"]
    ]
  );
});

test("direct and trailing-slash routes resolve without query state", () => {
  assert.equal(
    viewFromLocation({ pathname: "/projects", search: "" }),
    "projects"
  );
  assert.equal(
    viewFromLocation({ pathname: "/conversation/", search: "" }),
    "conversation"
  );
  assert.equal(viewFromLocation({ pathname: "/help", search: "" }), "help");
  assert.equal(
    viewFromLocation({ pathname: "/releases", search: "" }),
    "releases"
  );
  assert.equal(viewFromLocation({ pathname: "/trust", search: "" }), "trust");
  assert.equal(
    viewFromLocation({ pathname: "/accessibility", search: "" }),
    "accessibility"
  );
});

test("legacy view links still resolve and canonicalize without losing safe query data", () => {
  const legacy = new URL(
    "http://127.0.0.1:4311/?view=providers&mode=guided#workspace"
  );
  const view = viewFromLocation(legacy);
  const canonical = canonicalStudioUrl(legacy, view);
  assert.equal(view, "providers");
  assert.equal(canonical.pathname, "/providers");
  assert.equal(canonical.search, "?mode=guided");
  assert.equal(canonical.hash, "#workspace");
});

test("unknown routes fail safely to the overview route", () => {
  const unknown = new URL("http://127.0.0.1:4311/not-a-studio-page");
  const view = viewFromLocation(unknown);
  assert.equal(view, "overview");
  assert.equal(canonicalStudioUrl(unknown, view).pathname, "/");
});
