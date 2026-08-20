import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("provider consent remains implemented but is absent from the minimal Start history", async () => {
  const source = await readFile("apps/studio/src/components/projects/project-research-control.tsx", "utf8");
  const portfolio = await readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8");
  assert.doesNotMatch(portfolio, /ProjectResearchControl/);
  for (const copy of ["Choose free providers", "Test context", "Project context", "Start solution research?", "Context version", "Maximum cost", "$0", "Allow and start", "Change sharing"]) assert.equal(source.includes(copy), true, `missing ${copy}`);
  assert.match(source, /useState<readonly string\[]>\(\[\]\)/);
  assert.doesNotMatch(source, /<input|<textarea/);
  assert.match(source, /provider\.cost\.zeroCost/);
  assert.match(source, /!provider\.cost\.billingEnabled/);
});

test("Action Center surfaces owner-blocking solution research", async () => {
  const source = await readFile("apps/studio/src/components/activity/project-activity-dashboard.tsx", "utf8");
  assert.match(source, /getProjectSolutionRun/);
  assert.match(source, /run\.state === "needs_user"/);
  assert.match(source, /Solution research needs you/);
  assert.match(source, /run\.safeMessage/);
});
