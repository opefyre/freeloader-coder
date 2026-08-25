import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const command = await readFile("apps/studio/src/components/projects/project-stage-command.tsx", "utf8");
const app = await readFile("apps/studio/src/App.tsx", "utf8");
const portfolio = await readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8");
const activity = await readFile("apps/studio/src/components/activity/project-activity-dashboard.tsx", "utf8");

test("project detail presents one bounded owner command with consequences and recovery", () => {
  assert.equal((command.match(/<Button\b/g) ?? []).length, 1);
  for (const contract of [
    "Current stage",
    "Approval boundary",
    "What happens next",
    "If something is wrong",
    "Maximum automatic cost: $0",
  ]) {
    assert.equal(command.includes(contract), true, `missing command contract: ${contract}`);
  }
  assert.match(command, /ownerProjectGuidance\(props\.project\)/);
  assert.match(command, /props\.activate\(model\.primaryAction\.destination\)/);
});

test("project command remains above project tabs and routes to the relevant owner surface", () => {
  assert.match(app, /<ProjectStageCommand/);
  assert.match(app, /destination === "actions"/);
  assert.match(app, /navigate\("activity"\)/);
  assert.match(app, /setSection\(destination\)/);
  assert.ok(app.indexOf("<ProjectStageCommand") < app.indexOf("<Tabs\n        value={section}"));
});

test("portfolio and Action Center share the same owner-stage language", () => {
  assert.match(portfolio, /ownerProjectGuidance\(project\)/);
  assert.match(portfolio, /guidance\.stageLabel/);
  assert.match(portfolio, /guidance\.primaryAction\.label/);
  assert.match(portfolio, />Needs attention</);

  assert.match(activity, /ownerProjectGuidance\(project\)/);
  assert.match(activity, /Current stage · \{guidance\.stageLabel\}/);
  assert.match(activity, /guidance\.ownerStateLabel/);
});
