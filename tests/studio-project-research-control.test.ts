import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("projects automatically use the connected free-provider pool without a provider chooser", async () => {
  const source = await readFile("apps/studio/src/components/projects/project-research-control.tsx", "utf8");
  const portfolio = await readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8");
  assert.doesNotMatch(portfolio, /ProjectResearchControl/);
  assert.match(source, /All connected free providers are included automatically/);
  assert.match(source, /never uses paid capacity/);
  assert.match(source, /Start research/);
  for (const removed of ["Choose free providers", "Test context", "Project context", "Allow and start", "Change sharing"]) assert.equal(source.includes(removed), false, `obsolete ${removed}`);
  assert.doesNotMatch(source, /<input|<textarea/);
  assert.match(source, /credentialState === "active"/);
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
