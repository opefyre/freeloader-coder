import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync("apps/studio/src/components/resilience/resilience-center.tsx", "utf8");
const app = readFileSync("apps/studio/src/App.tsx", "utf8");
test("Settings mounts the complete Resilience Center", () => {
  assert.match(app, /<ResilienceCenter \/>/);
  for (const text of ["Storage ownership", "Atomic migration", "Outcome health", "Interruption recovery", "Reliability release gate"]) assert.match(source, new RegExp(text));
});
test("backup, restore, deletion, interruption, and chaos paths are interactive and explicit", () => {
  for (const text of ["Preview backup", "Verify restore", "Deletion dry run", "Simulate quota", "Simulate partial write", "Run restore drill"]) assert.match(source, new RegExp(text));
  assert.match(source, /credentials and provider tokens excluded/);
  assert.match(source, /nothing is overwritten silently/);
  assert.match(source, /0 duplicate effects/);
  assert.match(source, /aria-live="polite"/);
});
