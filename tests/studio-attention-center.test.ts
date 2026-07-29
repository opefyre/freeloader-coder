import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/attention/attention-center.tsx", "utf8");
const client = readFileSync("apps/studio/src/attention-client.ts", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");
const routing = readFileSync("apps/studio/src/routing.ts", "utf8");

test("Attention Center has a stable route, lazy workspace, and live global bell", () => {
  assert.match(routing, /attention:\s*\{\s*path: "\/attention"/);
  assert.match(app, /AttentionCenter = lazy/);
  assert.match(app, /AttentionBell = lazy/);
  assert.match(app, /view === "attention"/);
  assert.match(app, /<AttentionBell endpoint=\{controlPlane\.endpoint\}/);
  assert.match(app, /<AttentionCenter endpoint=\{controlPlaneEndpoint\}/);
});

test("Attention Center exposes truthful badge, popover, lanes, filters, details, acknowledgement, snooze, and quiet hours", () => {
  for (const phrase of ["Attention Center", "Live canonical attention", "Priority lanes", "Privacy boundary", "Acknowledge", "Snooze 1h", "Quiet hours", "All clear", "No attention matches these filters", "Attention Center is offline", "No sample count is substituted"]) assert.match(source, new RegExp(phrase, "i"));
  assert.match(source, /summary\.badge/);
  assert.match(source, /setInterval\(refresh, 15_000\)/);
  assert.match(source, /previewAttentionAction/);
  assert.match(source, /applyAttentionAction/);
  assert.match(source, /previewQuietHours/);
  assert.match(source, /updateQuietHours/);
  assert.doesNotMatch(source, /fixture/i);
});

test("Attention Center is accessible, responsive, quiet-aware, and explicit about effects", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="switch"/);
  assert.match(source, /aria-checked/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /focus-visible:ring/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /xl:grid-cols/);
  assert.match(source, /critical still delivered/i);
  assert.match(source, /does not change task state, contact a provider, write externally, or spend money/i);
});

test("attention client is loopback-only, bounded, no-store, credentialless, idempotent, abortable, and validated", () => {
  assert.match(client, /validateEndpoint/);
  assert.match(client, /MAX_RESPONSE_BYTES/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /credentials: "omit"/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /signal/);
  assert.match(client, /attentionSnapshotSchema\.parse/);
  assert.match(client, /attentionMutationResponseSchema\.parse/);
});
