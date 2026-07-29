import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one-command start builds and owns both foreground loopback services", async () => {
  const [script, manifest] = await Promise.all([
    readFile("scripts/start.mjs", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  for (const phrase of [
    '["run", "build"]',
    "control-plane-main.js",
    '["run", "studio:dev", "--", "--port", String(studioPort)]',
    "SIGINT",
    "SIGTERM",
    "SIGKILL",
    "Press Ctrl+C to stop both foreground services.",
  ]) {
    assert.equal(script.includes(phrase), true, `Missing local start contract: ${phrase}`);
  }
  assert.match(manifest, /"start": "node scripts\/start\.mjs"/);
  assert.doesNotMatch(script, /daemon|systemd|deploy/);
});
