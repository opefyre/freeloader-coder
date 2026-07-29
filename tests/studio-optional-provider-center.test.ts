import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = "apps/studio/src/components/providers/optional-provider-center.tsx";

test("optional provider center distinguishes every billing and auth surface", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const phrase of [
    "OpenAI API", "API-key billing", "Responses API",
    "Codex worker", "Codex login or entitlement", "App server / SDK",
    "Anthropic API", "Anthropic Console billing", "Messages API",
    "ChatGPT, Codex, and Claude subscriptions do not enable API billing",
  ]) assert.equal(source.includes(phrase), true, `Missing literal UI copy: ${phrase}`);
});

test("optional provider center exposes hard stops, sources, and no activation", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const phrase of [
    "$0 spent", "0 paid calls", "All integrations disabled",
    "Request · task · day · month", "Paid fallback denied",
    "Hard budget reached", "Emergency shutdown active",
    "Official interface", "Paid safety policy",
  ]) assert.equal(source.includes(phrase), true, `Missing literal UI copy: ${phrase}`);
  assert.match(source, /aria-live/);
  assert.match(source, /focus-visible:ring/);
  assert.doesNotMatch(source, /Connect now|Enable paid|react-icons|lucide|bg-gradient|linear-gradient/);
});
