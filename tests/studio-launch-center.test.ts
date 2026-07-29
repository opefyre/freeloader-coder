import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = "apps/studio/src/components/launch/launch-center.tsx";

test("Launch route mounts the local interactive launch center", async () => {
  const [app, routes] = await Promise.all([
    readFile("apps/studio/src/App.tsx", "utf8"),
    readFile("apps/studio/src/routing.ts", "utf8"),
  ]);
  assert.match(app, /LaunchCenter/);
  assert.match(routes, /launch: "\/launch"/);
});

test("launch center proves positioning, demo, comparison, operations, and learning", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const phrase of [
    "Reliable autonomous development, without a surprise AI bill.",
    "Failure-to-recovery demo",
    "OpenCode",
    "OpenHands",
    "Aider",
    "Release gates",
    "Outcome scorecard",
    "Public launch remains paused",
  ]) {
    assert.equal(source.includes(phrase), true, `Missing launch content: ${phrase}`);
  }
});

test("launch center is source-linked, interactive, local-only, and responsive", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const phrase of [
    "https://github.com/opefyre/freeloader-coder",
    "https://opencode.ai/docs/",
    "https://docs.openhands.dev/overview/introduction",
    "https://aider.chat/docs/",
    "No real task was created",
    "No public URL was created",
    "No service was contacted",
    "aria-live",
    "focus-visible:ring",
    "sm:grid-cols-4",
    "xl:grid-cols",
  ]) {
    assert.equal(source.includes(phrase), true, `Missing launch contract: ${phrase}`);
  }
  assert.doesNotMatch(source, /react-icons|lucide|bg-gradient|linear-gradient/);
});

