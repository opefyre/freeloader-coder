import test from "node:test";
import assert from "node:assert/strict";

import { reconcileProjectProgress } from "../packages/runtime/src/project-progress-reconciliation.js";

const projectId = "project_0123456789abcdef";
const now = 1_000_000;

test("reconciliation derives percentages only from current Jira evidence and selects the newest evidenced update", () => {
  const result = reconcileProjectProgress({
    projectId,
    jira: { projectId, completed: 2, total: 4, blocked: 1, observedAt: now - 100, freshUntil: now + 60_000, latest: { issueKey: "PIPE-2", summary: "Jira update", occurredAt: now - 50, url: "https://example.atlassian.net/browse/PIPE-2" }, issues: new Map([["PIPE-1", "done"], ["PIPE-2", "active"]]) },
    execution: { projectId, observedAt: now - 10, latest: { issueKey: "PIPE-2", summary: "Validation passed", occurredAt: now - 10 }, issues: new Map([["PIPE-1", "done"], ["PIPE-2", "active"]]) },
    lifecycle: { stage: "delivery", updatedAt: now - 1000 },
    now,
  });
  assert.deepEqual(result.progress, { completed: 2, total: 4, blocked: 1, percent: 50 });
  assert.equal(result.latest?.source, "execution");
  assert.equal(result.confidence, "verified");
  assert.deepEqual(result.disagreements, []);
});

test("missing Jira never invents progress and stale or conflicting evidence is explicit", () => {
  const missing = reconcileProjectProgress({ projectId, jira: null, execution: { projectId, observedAt: now, latest: null, issues: new Map() }, lifecycle: null, now });
  assert.equal(missing.progress, null);
  assert.equal(missing.confidence, "partial");
  assert.equal(missing.disagreements[0]?.code, "missing_jira");
  const conflict = reconcileProjectProgress({
    projectId,
    jira: { projectId, completed: 0, total: 1, blocked: 0, observedAt: now - 100_000, freshUntil: now - 1, latest: null, issues: new Map([["PIPE-1", "todo"]]) },
    execution: { projectId, observedAt: now, latest: null, issues: new Map([["PIPE-1", "done"]]) },
    lifecycle: null,
    now,
  });
  assert.equal(conflict.confidence, "partial");
  assert.deepEqual(conflict.disagreements.map((item) => item.code), ["task_state_conflict", "stale_source"]);
});

test("cross-project evidence is rejected and cannot contaminate metrics", () => {
  const result = reconcileProjectProgress({ projectId, jira: { projectId: "project_aaaaaaaaaaaaaaaa", completed: 10, total: 10, blocked: 0, observedAt: now, freshUntil: now + 1, latest: null, issues: new Map() }, execution: null, lifecycle: null, now });
  assert.equal(result.progress, null);
  assert.equal(result.confidence, "unknown");
  assert.deepEqual(result.disagreements.map((item) => item.code), ["project_mismatch", "missing_jira"]);
});
