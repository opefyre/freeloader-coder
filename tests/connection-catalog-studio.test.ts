import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Settings uses an honest minimal app-level connection catalogue", async () => {
  const source = await readFile("apps/studio/src/components/settings/connection-catalog.tsx", "utf8");
  for (const name of ["AI providers", "GitHub", "Jira", "Telegram", "Discord", "Slack", "Cloudflare", "Google Cloud", "AWS", "Vercel"]) {
    assert.equal(source.includes(name), true, `Missing connection: ${name}`);
  }
  assert.equal(source.includes("Not connected"), true);
  assert.equal(source.includes("opefyre"), false);
  assert.equal(source.includes("PIPE-72"), false);
  assert.equal(source.includes('type="password"'), true);
  assert.equal(source.includes('autoComplete="off"'), true);
  assert.equal(source.includes("connectJiraConnection"), true);
  assert.equal(source.includes("secret-token"), false);
});
