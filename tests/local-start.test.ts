import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one-command start builds and owns the unified loopback stack", async () => {
  const [script, manifest] = await Promise.all([
    readFile("scripts/start-agent-canvas.mjs", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  for (const phrase of [
    '["run", "build"]',
    "control-plane-main.js",
    "agent-canvas-model-gateway-main.js",
    "apps/studio/vite.config.ts",
    "scripts/dev-with-automation.mjs",
    "SIGINT",
    "SIGTERM",
    "Pipeline Studio is starting on loopback.",
  ]) {
    assert.equal(script.includes(phrase), true, `Missing local start contract: ${phrase}`);
  }
  assert.match(manifest, /"start": "node scripts\/start-agent-canvas\.mjs"/);
  assert.doesNotMatch(script, /daemon|systemd|deploy/);
});
