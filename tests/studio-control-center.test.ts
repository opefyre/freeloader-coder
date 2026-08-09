import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/control-center/control-center.tsx", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");
const client = readFileSync("apps/studio/src/live-operations-client.ts", "utf8");

test("legacy Control Center remains endpoint-backed but is not the primary Activity surface", () => {
  assert.match(app, /ControlCenter/);
  assert.match(app, /ProjectActivityDashboard/);
  for (const heading of ["Live operations", "Work distribution", "Recent operational evidence", "Free-provider readiness"]) {
    assert.match(source, new RegExp(heading));
  }
  assert.doesNotMatch(source, /control-center-fixture|controlCenterMetric|providerShare|throughputPoints/);
});

test("live visual elements expose freshness, provenance, and drill-down", () => {
  assert.match(source, /snapshot\.provenance/);
  assert.match(source, /snapshot\.observedAt/);
  assert.match(source, /setSelectedEventId/);
  assert.match(source, /navigate\("evidence"\)/);
  assert.match(source, /navigate\("work"\)/);
  assert.match(source, /navigate\("providers"\)/);
  assert.match(source, /navigate\("projects"\)/);
});

test("offline, stale, empty, and accessible states remain truthful", () => {
  assert.match(source, /Local control plane is offline/);
  assert.match(source, /Preserved stale data/);
  assert.match(source, /No activity yet/);
  assert.match(source, /No provider connected/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="img"/);
  assert.match(source, /focus-visible:ring/);
});

test("client is loopback-only, bounded, abortable, and schema validated", () => {
  assert.match(client, /validateEndpoint/);
  assert.match(client, /MAX_RESPONSE_BYTES/);
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /signal/);
  assert.match(client, /validateLiveOperationsSnapshot/);
});
