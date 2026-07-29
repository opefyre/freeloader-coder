import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/orchestration/autonomous-work-center.tsx", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");
const client = readFileSync("apps/studio/src/autonomy-client.ts", "utf8");

test("Work mounts the live coordinator and removes simulated orchestration controls", () => {
  assert.match(app, /<AutonomousWorkCenter endpoint=\{controlPlaneEndpoint\} \/>/);
  assert.doesNotMatch(app, /<ExecutionSafetyPanel \/>/);
  assert.doesNotMatch(app, /<OrchestrationWorkbench \/>/);
  assert.doesNotMatch(app, /The orchestration controls below are an interactive preview/);
});

test("Work Center exposes canonical queue, boundaries, schedules, filters, and project policy", () => {
  for (const phrase of ["Autonomous work", "Canonical queue", "Project autonomy", "Authority boundary", "Maximum cost", "No work yet", "Coordinator is offline", "Preserved stale view"]) {
    assert.match(source, new RegExp(phrase));
  }
  assert.match(source, /safe_action/);
  assert.match(source, /approval/);
  assert.match(source, /waiting/);
  assert.match(source, /attention/);
  assert.match(source, /terminal/);
});

test("consequential controls preview impact and resist duplicate or stale submission", () => {
  assert.match(source, /Preview safe step/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /expectedUpdatedAt/);
  assert.match(source, /if \(!pending \|\| working\) return/);
  assert.match(source, /disabled=\{working\}/);
  assert.match(source, /confirmBroaderAutomation: true/);
});

test("Work Center is responsive, keyboard operable, and semantically live", () => {
  assert.match(source, /sm:grid-cols/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /focus-visible:ring/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-live="polite"/);
});

test("coordinator client is loopback-only, bounded, idempotent, abortable, and validated", () => {
  assert.match(client, /validateEndpoint/);
  assert.match(client, /MAX_RESPONSE_BYTES/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /signal/);
  assert.match(client, /validateAutonomySnapshot/);
});
