import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("portfolio is a concise recent-projects scan", async () => {
  const source = await readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8");
  for (const contract of ["Recent projects", "Needs attention"]) {
    assert.equal(source.includes(contract), true, `missing portfolio contract: ${contract}`);
  }

  assert.match(source, /project\.latestUpdate\?\.summary/);
  assert.match(source, /relativeTime\(project\.latestUpdate\.occurredAt\)/);
  assert.match(source, /needsAttention\(project\)/);
  assert.doesNotMatch(source, /latestByProject|listLocalRequests/);
});

test("portfolio uses simple accessible project rows without dashboard metrics", async () => {
  const source = await readFile("apps/studio/src/components/projects/project-portfolio.tsx", "utf8");
  assert.match(source, /type="button"/);
  assert.match(source, /props\.openProject\(project\.id\)/);
  assert.doesNotMatch(source, /role="progressbar"|aria-valuemax|metric sources/);
});
