import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("portfolio is a concise source-backed owner scan", async () => {
  const source = await readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8");
  for (const contract of [
    "Project portfolio summary",
    "Needs attention",
    "Latest update",
    "Next milestone",
    "sources current",
    "metric sources",
    "No percentage is inferred without Jira evidence.",
  ]) assert.equal(source.includes(contract), true, `missing portfolio contract: ${contract}`);

  assert.match(source, /project\.latestUpdate\.summary/);
  assert.match(source, /relativeTime\(project\.latestUpdate\.occurredAt\)/);
  assert.match(source, /project\.reconciliation\?\.evidence/);
  assert.match(source, /project\.reconciliation\?\.disagreements/);
  assert.doesNotMatch(source, /latestByProject|listLocalRequests/);
});

test("portfolio progress has a textual accessible alternative and links to evidence", async () => {
  const source = await readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8");
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuemin=\{0\}/);
  assert.match(source, /aria-valuemax=\{100\}/);
  assert.match(source, /of \$\{progress\.total\} Jira items complete/);
  assert.match(source, /href=\{project\.latestUpdate\.url\}/);
  assert.match(source, /target="_blank" rel="noreferrer"/);
  assert.match(source, /grid gap-3 lg:grid-cols-2/);
});
