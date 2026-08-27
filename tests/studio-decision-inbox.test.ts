import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/decisions/decision-inbox.tsx", "utf8");
const client = readFileSync("apps/studio/src/decision-client.ts", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");

test("legacy Decisions route remains available while the primary Action Center is project scoped", () => {
  assert.match(app, /DecisionInbox = lazy/);
  assert.match(app, /view === "decisions"/);
  assert.match(app, /<DecisionInbox/);
  assert.match(app, /ProjectActivityDashboard/);
  assert.match(app, /AttentionBell = lazy/);
  assert.match(app, /openCenter=\{\(\) => navigate\("activity"\)\}/);
  assert.match(app, /activeView !== "decisions"/);
});

test("Decision Inbox exposes metrics, lanes, filters, search, inspector, references, and export", () => {
  for (const phrase of ["Decision inbox", "Focus the queue", "Decision priority lanes", "Canonical evidence", "Privacy boundary", "All clear", "No decisions match these filters", "Decision Inbox is offline", "Preserved stale queue"]) {
    assert.match(source, new RegExp(phrase, "i"));
  }
  assert.match(source, /activeCategories/);
  assert.match(source, /activePriorities/);
  assert.match(source, /activeOwners/);
  assert.match(source, /activeAges/);
  assert.match(source, /useDeferredValue/);
  assert.match(source, /createDecisionExport/);
  assert.match(source, /selected\.reference\.path/);
  assert.doesNotMatch(source, /fixture/i);
});

test("Decision Inbox is accessible, responsive, zero-cost, and truthful when stale", () => {
  assert.match(source, /aria-labelledby="decision-inbox-title"/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /focus-visible:ring/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /2xl:grid-cols/);
  assert.match(source, /\$0 automatic spend/);
  assert.match(source, /last valid queue/);
  assert.match(source, /No resolution or progress was inferred/);
});

test("Decision Inbox leads with bounded consequence and recovery before approval controls", () => {
  for (const phrase of ["Decision", "Target", "Consequence", "Recovery", "backlog planning only", "Implementation and deployment remain blocked", "Request changes", "decline"]) {
    assert.match(source, new RegExp(phrase, "i"));
  }
  assert.ok(source.indexOf('label="Consequence"') < source.indexOf('onClick={() => void decideSolution("approved")}'));
  assert.ok(source.indexOf('label="Recovery"') < source.indexOf('onClick={() => void decideSolution("approved")}'));
});

test("decision client is loopback-only, bounded, abortable, no-store, credentialless, and validated", () => {
  assert.match(client, /validateEndpoint/);
  assert.match(client, /MAX_RESPONSE_BYTES/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /signal/);
  assert.match(client, /decisionSnapshotSchema\.parse/);
  assert.match(client, /decisionExportSchema\.parse/);
});
