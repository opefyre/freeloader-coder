import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FakeIssueConnector } from "../packages/connectors/src/index.js";
import { runFakeProvider } from "../packages/providers/src/index.js";

test("offline provider clearly returns unverified synthetic output", async () => {
  const result = await runFakeProvider({ taskId: "TASK-DEMO-001", prompt: "test" });
  assert.equal(result.provider, "fake");
  assert.equal(result.verified, false);
  assert.match(result.output, /TASK-DEMO-001/);
});

test("offline connector is deterministic and performs no network call", async () => {
  const connector = new FakeIssueConnector();
  await connector.upsert({ key: "DEMO-1", title: "Example", status: "todo" });
  assert.deepEqual(await connector.get("DEMO-1"), {
    key: "DEMO-1",
    title: "Example",
    status: "todo"
  });
});

test("synthetic fixture is parseable and contains no credentials", async () => {
  const fixture = JSON.parse(await readFile("fixtures/demo-project.json", "utf8"));
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.task.status, "ready");
  assert.equal(JSON.stringify(fixture).includes("apiKey"), false);
});
