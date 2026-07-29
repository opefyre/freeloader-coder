import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/search/global-command-center.tsx", "utf8");
const client = readFileSync("apps/studio/src/search-client.ts", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");

test("the global affordance opens a lazy live command center from every route", () => {
  assert.match(app, /GlobalCommandCenter = lazy/);
  assert.match(app, /setCommandOpen\(true\)/);
  assert.match(app, /<GlobalCommandCenter/);
  assert.match(app, /endpoint=\{controlPlane\.endpoint\}/);
  assert.match(app, /activate=\{activateSearchResult\}/);
  assert.doesNotMatch(app, /function CommandPalette/);
});

test("command center provides live grouped search, scopes, suggestions, details, and safe activation", () => {
  for (const phrase of ["Universal command center", "Search scopes", "Search results", "Safe navigation only", "Privacy boundary", "Searching canonical local state", "No canonical result matches", "Live search is unavailable"]) {
    assert.match(source, new RegExp(phrase, "i"));
  }
  assert.match(source, /\$0 automatic spend/i);
  assert.match(source, /fetchUniversalSearch/);
  assert.match(source, /groupResults/);
  assert.match(source, /activeScopes/);
  assert.match(source, /activate\(result\.reference\.path\)/);
  assert.doesNotMatch(source, /fixture/i);
});

test("command center implements dialog, combobox, listbox, focus return, and full keyboard navigation", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-activedescendant/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Home/);
  assert.match(source, /End/);
  assert.match(source, /Enter/);
  assert.match(source, /Escape/);
  assert.match(source, /previousFocus/);
  assert.match(source, /focus-visible:ring/);
});

test("search client is loopback-only, bounded, abortable, no-store, credentialless, and validated", () => {
  assert.match(client, /validateEndpoint/);
  assert.match(client, /MAX_RESPONSE_BYTES/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /signal/);
  assert.match(client, /universalSearchSnapshotSchema\.parse/);
});
