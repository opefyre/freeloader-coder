import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/studio/src/components/quality/evidence-center.tsx", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");

test("Evidence route mounts the interactive quality center", () => {
  assert.match(app, /<EvidenceCenter \/>/);
  for (const section of ["Quality is a release decision", "Evidence browser", "Independent review quorum", "Bounded healing"]) {
    assert.match(source, new RegExp(section));
  }
});

test("evidence is filterable, selectable, downloadable, and source linked", () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-selected=\{filter === item\}/);
  assert.match(source, /setSelectedId/);
  assert.match(source, /Download/);
  assert.match(source, /opefyre\.atlassian\.net\/browse\/PIPE-64/);
});

test("quorum and healing failure paths are interactive and explicit", () => {
  assert.match(source, /Simulate dissent/);
  assert.match(source, /Readiness blocked/);
  assert.match(source, /Run bounded recovery/);
  assert.match(source, /Simulate exhausted budget/);
  assert.match(source, /Evidence preserved · user decision required/);
  assert.match(source, /aria-live="polite"/);
});
