import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "apps/studio/src/components/activity/project-activity-dashboard.tsx",
  "utf8",
);

test("project analytics declares canonical execution evidence and renders retry and cycle metrics", () => {
  assert.match(
    source,
    /delivery health from canonical local execution evidence/,
  );
  assert.match(source, /label="Retries"/);
  assert.match(source, /label="Cycle"/);
  assert.match(source, /task\.updatedAt - task\.assignment\.selectedAt/);
  assert.match(source, /Unknown/);
});

test("Action Center groups owner work by project and links recovery to the selected project", () => {
  assert.match(source, /aria-labelledby={`actions-\$\{project\.id\}`}/);
  assert.match(source, /href={`\/projects\/\$\{record\.projectId\}`}/);
  assert.match(source, /Choose the project direction/);
  assert.match(source, /Review the proposed solution/);
});

test("Action Center suppresses stale execution attention after a project reaches a terminal lifecycle", () => {
  assert.match(
    source,
    /\["complete", "cancelled"\]\.includes\(lifecycle\.stage\)/,
  );
  assert.match(source, /!terminalProjectIds\.has\(record\.projectId\)/);
});
