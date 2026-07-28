import assert from "node:assert/strict";
import test from "node:test";

import {
  createJiraSelection,
  evaluateJiraDataPolicy,
  importJiraTaskGraph,
  planJiraSync,
  verifyJiraSync,
  type JiraTaskGraph
} from "../packages/integrations/src/index.js";

const revision = "b".repeat(64);
const grounding = "c".repeat(64);

test("Jira selection records stable IDs, source revision, and unavailable fields honestly", () => {
  const selection = createJiraSelection({
    cloudId: "cloud-1",
    siteLabel: "Opefyre Jira",
    projectId: "10001",
    projectKey: "PIPE",
    boardId: "133",
    issueIds: ["10072", "10073"],
    issueKeys: ["PIPE-72", "PIPE-73"],
    sourceRevision: revision,
    selectedAt: 1_800_000_000_000,
    unavailableFields: ["attachments", "worklogs", "attachments"]
  });
  assert.deepEqual(selection.issueIds, ["10072", "10073"]);
  assert.deepEqual(selection.unavailableFields, ["attachments", "worklogs"]);
  assert.throws(
    () => createJiraSelection({ ...selection, sourceRevision: "unknown" }),
    /revision/
  );
});

test("Jira import produces cited grounded tasks and cannot duplicate an active graph", () => {
  const issue = {
    id: "10072",
    key: "PIPE-72",
    summary: "Connect GitHub safely",
    description: "Select exact repositories and permissions.",
    acceptanceCriteria: ["No broad PAT", "Revocation stops work"],
    dependencies: ["PIPE-43"],
    sourceRevision: revision
  };
  const graph = importJiraTaskGraph({
    issue,
    projectGroundingDigest: grounding,
    observedSourceRevision: revision,
    activeGraphs: []
  });
  assert.equal(graph.state, "ready");
  assert.equal(graph.tasks.length, 2);
  for (const task of graph.tasks) {
    assert.deepEqual(task.citations, [
      `jira://10072@${revision}`,
      `project-grounding://${grounding}`
    ]);
  }
  const duplicate = importJiraTaskGraph({
    issue,
    projectGroundingDigest: grounding,
    observedSourceRevision: revision,
    activeGraphs: [graph]
  });
  assert.equal(duplicate, graph);
});

test("changed Jira source and ambiguity block consequential execution", () => {
  const stale = importJiraTaskGraph({
    issue: {
      id: "10078",
      key: "PIPE-78",
      summary: "Import Jira work",
      description: "",
      acceptanceCriteria: [],
      dependencies: [],
      sourceRevision: revision
    },
    projectGroundingDigest: grounding,
    observedSourceRevision: "d".repeat(64),
    activeGraphs: []
  });
  assert.equal(stale.state, "stale");
  assert.equal(stale.questions.length, 2);
});

test("private Jira content remains local unless a provider is explicitly approved", () => {
  assert.deepEqual(evaluateJiraDataPolicy({
    issueVisibility: "private",
    providerDataClasses: ["public_test", "source_code"]
  }), {
    allowed: false,
    reason: "Private Jira content remains local for this provider."
  });
  assert.equal(evaluateJiraDataPolicy({
    issueVisibility: "private",
    providerDataClasses: ["private_project"]
  }).allowed, true);
});

test("Jira Done requires observed checks and review, while conflicts and revoked grants preserve work", () => {
  const base = {
    issueId: "10079",
    issueKey: "PIPE-79",
    sourceRevision: revision,
    currentRevision: revision,
    requestedStatus: "Done" as const,
    comment: "Validated checkpoint is ready.",
    links: ["https://github.com/opefyre/freeloader-coder/commit/abc"],
    evidence: {
      deterministicChecksPassed: false,
      reviewQuorumPassed: false,
      modelClaimOnly: true
    },
    permissionState: "ready" as const,
    existingReceipts: []
  };
  assert.equal(planJiraSync(base).state, "evidence_blocked");
  assert.equal(planJiraSync({ ...base, currentRevision: "d".repeat(64) }).state, "conflict");
  assert.equal(planJiraSync({ ...base, permissionState: "revoked" }).state, "permission_denied");
});

test("verified Jira synchronization is idempotent and cannot duplicate comments or links", () => {
  const preview = planJiraSync({
    issueId: "10079",
    issueKey: "PIPE-79",
    sourceRevision: revision,
    currentRevision: revision,
    requestedStatus: "Done",
    comment: "All deterministic checks and review quorum passed.",
    links: ["https://github.com/opefyre/freeloader-coder/pull/12"],
    evidence: {
      deterministicChecksPassed: true,
      reviewQuorumPassed: true,
      modelClaimOnly: false
    },
    permissionState: "ready",
    existingReceipts: []
  });
  assert.equal(preview.state, "ready");
  const receipt = verifyJiraSync({
    marker: preview.marker,
    issueId: "10079",
    expectedFields: preview.changes,
    observedFields: preview.changes,
    observedRevision: "d".repeat(64),
    matchingMarkers: 1,
    now: 1_800_000_000_000
  });
  const replay = planJiraSync({
    issueId: "10079",
    issueKey: "PIPE-79",
    sourceRevision: revision,
    currentRevision: revision,
    requestedStatus: "Done",
    comment: "All deterministic checks and review quorum passed.",
    links: ["https://github.com/opefyre/freeloader-coder/pull/12"],
    evidence: {
      deterministicChecksPassed: true,
      reviewQuorumPassed: true,
      modelClaimOnly: false
    },
    permissionState: "ready",
    existingReceipts: [receipt]
  });
  assert.equal(replay.state, "already_verified");
  assert.deepEqual(replay.changes, []);
});
