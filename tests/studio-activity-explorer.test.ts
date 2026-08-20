import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/activity/activity-explorer.tsx", "utf8");
const client = readFileSync("apps/studio/src/activity-client.ts", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");

test("Activity route mounts only the project-scoped Action Center", () => {
  assert.match(app, /ProjectActivityDashboard = lazy/);
  assert.match(app, /mode="actions"/);
  assert.match(app, /mode="analytics" projectId=\{selectedProjectId\}/);
});

test("Activity Explorer exposes live filters, search, timeline, inspector, references, and export", () => {
  for (const phrase of ["Activity explorer", "Canonical timeline", "Privacy boundary", "Bounded current-state history", "No activity yet", "No activity matches these filters", "Activity is offline", "Preserved stale view"]) {
    assert.match(source, new RegExp(phrase, "i"));
  }
  assert.match(source, /activeKinds/);
  assert.match(source, /activeSeverities/);
  assert.match(source, /useDeferredValue/);
  assert.match(source, /createActivityExport/);
  assert.match(source, /selected\.reference\.path/);
  assert.doesNotMatch(source, /fixture/i);
  assert.match(source, /No sample history or inferred progress is shown/);
});

test("Activity Explorer is accessible, responsive, and preserves truthful stale state", () => {
  assert.match(source, /aria-labelledby="activity-explorer-title"/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /focus-visible:ring/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /last valid observation/);
  assert.match(source, /No new progress was inferred/);
});

test("activity client is loopback-only, bounded, abortable, no-store, credentialless, and validated", () => {
  assert.match(client, /validateEndpoint/);
  assert.match(client, /MAX_RESPONSE_BYTES/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /signal/);
  assert.match(client, /validateActivitySnapshot/);
  assert.match(client, /activityExportSchema\.parse/);
});
