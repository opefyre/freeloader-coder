import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateGitHubModels,
  planCheckpointPublish,
  planRepositoryImport,
  verifyPublishPostconditions,
  type GitHubAccess,
  type RepositoryCandidate
} from "../packages/integrations/src/index.js";

const access: GitHubAccess = {
  accountId: "account-1",
  repositoryIds: ["repo-1"],
  permissions: [
    "identity:read",
    "contents:read",
    "contents:write",
    "pull_requests:write"
  ],
  modelsEnabled: false,
  modelsAttribution: null
};
const repository: RepositoryCandidate = {
  id: "repo-1",
  owner: "opefyre",
  name: "freeloader-coder",
  defaultBranch: "main",
  private: true,
  protectedBranches: ["main"],
  features: ["lfs", "submodules"]
};
const digest = "a".repeat(64);

test("repository import refuses overwrite and preserves checkpoints during conflict", () => {
  const blocked = planRepositoryImport({
    access,
    repository,
    branch: "main",
    destination: "/Projects/freeloader-coder",
    destinationState: "existing_unrelated",
    localState: "clean"
  });
  assert.equal(blocked.action, "blocked");
  assert.match(blocked.nextAction, /empty folder/);
  const conflict = planRepositoryImport({
    access,
    repository,
    branch: "main",
    destination: "/Projects/freeloader-coder",
    destinationState: "existing_project",
    localState: "diverged"
  });
  assert.equal(conflict.action, "guided_conflict");
  assert.equal(conflict.preservesCheckpoints, true);
  assert.deepEqual(conflict.warnings.length, 2);
});

test("guided and balanced publishing requires approval and replay cannot duplicate a pull request", () => {
  const input = {
    access,
    repository,
    checkpointDigest: digest,
    baseBranch: "main",
    proposedBranch: "pipeline/pipe-73",
    changedFiles: ["src/App.tsx"],
    checksPassed: ["typecheck", "build"],
    approvalMode: "balanced" as const,
    approved: false,
    existingReceipts: []
  };
  const preview = planCheckpointPublish(input);
  assert.equal(preview.state, "awaiting_approval");
  assert.equal(preview.externalEffects.length, 3);
  const receipt = verifyPublishPostconditions({
    idempotencyKey: preview.idempotencyKey,
    expectedRepository: "opefyre/freeloader-coder",
    branchUrl: "https://github.com/opefyre/freeloader-coder/tree/pipeline/pipe-73",
    commitUrl: "https://github.com/opefyre/freeloader-coder/commit/abc",
    pullRequestUrl: "https://github.com/opefyre/freeloader-coder/pull/12",
    observedOpenPullRequests: 1,
    now: 1_800_000_000_000
  });
  const replay = planCheckpointPublish({
    ...input,
    approved: true,
    existingReceipts: [receipt]
  });
  assert.equal(replay.state, "already_verified");
  assert.deepEqual(replay.externalEffects, []);
  assert.equal(replay.existingReceipt?.pullRequestUrl, receipt.pullRequestUrl);
});

test("publish verification rejects wrong repositories and duplicate pull requests", () => {
  const base = {
    idempotencyKey: "key",
    expectedRepository: "opefyre/freeloader-coder",
    branchUrl: "https://github.com/opefyre/freeloader-coder/tree/safe",
    commitUrl: "https://github.com/opefyre/freeloader-coder/commit/abc",
    pullRequestUrl: "https://github.com/opefyre/freeloader-coder/pull/12",
    observedOpenPullRequests: 1,
    now: 1_800_000_000_000
  };
  assert.throws(
    () => verifyPublishPostconditions({ ...base, observedOpenPullRequests: 2 }),
    /exactly one/
  );
  assert.throws(
    () => verifyPublishPostconditions({
      ...base,
      commitUrl: "https://github.com/other/repository/commit/abc"
    }),
    /wrong repository/
  );
});

test("GitHub Models is separately permissioned, attributed, quota-bound, and never widens repository access", () => {
  const modelAccess: GitHubAccess = {
    ...access,
    permissions: [...access.permissions, "models:read"],
    modelsEnabled: true,
    modelsAttribution: "organization:opefyre"
  };
  const decision = evaluateGitHubModels({
    access: modelAccess,
    requestedModel: "openai/gpt-4.1-mini",
    allowedModels: ["openai/gpt-4.1-mini"],
    billingEnabled: false,
    remainingRequests: 42
  });
  assert.equal(decision.admitted, true);
  assert.equal(decision.repositoryAccessChanged, false);
  assert.equal(decision.attribution, "organization:opefyre");
  assert.equal(evaluateGitHubModels({
    access: { ...modelAccess, modelsEnabled: false },
    requestedModel: "openai/gpt-4.1-mini",
    allowedModels: ["openai/gpt-4.1-mini"],
    billingEnabled: false,
    remainingRequests: 42
  }).reason, "disabled");
  assert.equal(evaluateGitHubModels({
    access: modelAccess,
    requestedModel: "openai/gpt-4.1-mini",
    allowedModels: ["openai/gpt-4.1-mini"],
    billingEnabled: true,
    remainingRequests: 42
  }).reason, "billing_enabled");
});
