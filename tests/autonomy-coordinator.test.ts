import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalAutonomyError, LocalAutonomyService, type LocalAutonomyActions } from "../apps/core/src/local-autonomy-service.js";
import { planSafeNextAction } from "../packages/orchestration/src/safe-next-action.js";
import type { CoordinatorAction } from "../packages/runtime/src/autonomy.js";
import type { LocalRequest, LocalRequestCollection } from "../packages/runtime/src/local-requests.js";

const now = 1_800_000_000_000;
function request(overrides: Partial<LocalRequest> = {}): LocalRequest {
  return {
    schemaVersion: 1,
    id: "request_0123456789abcdef0123",
    projectId: "project_0123456789abcdef",
    outcome: "Build a live work coordinator.",
    readiness: "ready",
    state: "queued",
    provenance: "local_request",
    createdAt: now - 1_000,
    updatedAt: now,
    findings: [],
    workPreview: null,
    run: null,
    ...overrides,
  };
}
const grounded = {
  schemaVersion: 1 as const,
  projectId: "project_0123456789abcdef",
  provenance: "bounded_local_files" as const,
  digest: "a".repeat(64),
  observedAt: now,
  sources: [{ path: "README.md", sha256: "b".repeat(64), bytes: 10, classification: "documentation" as const, excerpt: "Guide" }],
  limitations: ["Bounded source."],
};
const topology = {
  schemaVersion: 1 as const,
  projectId: "project_0123456789abcdef",
  provenance: "bounded_path_inventory" as const,
  digest: "c".repeat(64),
  observedAt: now,
  entries: [{ path: "src/index.ts", kind: "source" as const, extension: ".ts", bytes: 10 }],
  truncated: false,
  excludedDirectories: ["node_modules"],
  limitations: ["Bounded inventory."],
};
const plan = {
  schemaVersion: 1 as const,
  provenance: "deterministic_local_plan" as const,
  digest: "d".repeat(64),
  groundingDigest: grounded.digest,
  topologyDigest: topology.digest,
  revision: 1,
  state: "draft" as const,
  order: ["task_0123456789ab"],
  approval: null,
  tasks: [{
    id: "task_0123456789ab",
    title: "Implement",
    outcome: "Implement coordinator.",
    scope: ["Coordinator"],
    allowedFiles: ["src/index.ts"],
    citedSources: ["README.md"],
    dependsOn: [],
    acceptanceCriteria: ["Tests pass"],
    exclusions: ["No deployment"],
    checks: ["npm test"],
    risk: "medium" as const,
    estimatedMinutes: 30,
  }],
};

test("planner stops at human authority boundaries and allows only evidenced safe steps", () => {
  const queued = planSafeNextAction({ request: request(), mode: "autonomous", paused: false, now });
  assert.equal(queued.boundary, "approve_request");
  assert.equal(queued.automaticAllowed, false);
  const grounding = planSafeNextAction({ request: request({ state: "approved", run: approvedRun() }), mode: "autonomous", paused: false, now });
  assert.equal(grounding.action, "ground_request");
  assert.equal(grounding.automaticAllowed, true);
  const draft = planSafeNextAction({ request: request({ state: "approved", run: approvedRun(), grounding: grounded, topology, plan }), mode: "autonomous", paused: false, now });
  assert.equal(draft.boundary, "approve_plan");
  assert.equal(draft.action, null);
  const authorized = planSafeNextAction({
    request: request({ state: "approved", run: approvedRun(), grounding: grounded, topology, plan: approvedPlan(), execution: authorizedExecution() }),
    mode: "autonomous",
    paused: false,
    now,
  });
  assert.equal(authorized.action, "prepare_execution");
  assert.equal(authorized.effect, "authorized_local_write");
  assert.equal(authorized.maximumCostUsd, 0);
});

test("planner distinguishes provider waits, interruption, pause, and terminal work", () => {
  const deferred = planSafeNextAction({
    request: request({
      state: "approved", run: approvedRun(), grounding: grounded, topology, plan: approvedPlan(),
      execution: { ...authorizedExecution(), state: "validated", workspace: null, run: executionRun(), proposal: {
        schemaVersion: 1, state: "deferred", prompt: proposalPrompt(), proposal: null, decision: null,
        artifactDigest: null, retryAt: now + 60_000, safeMessage: "Free quota resets soon.", generation: null,
      } },
    }),
    mode: "autonomous", paused: false, now,
  });
  assert.equal(deferred.classification, "waiting");
  assert.equal(deferred.retryAt, now + 60_000);
  const paused = planSafeNextAction({ request: request({ state: "approved", run: approvedRun() }), mode: "autonomous", paused: true, now });
  assert.equal(paused.action, "ground_request");
  assert.equal(paused.automaticAllowed, false);
  assert.equal(planSafeNextAction({ request: request({ state: "interrupted" }), mode: "autonomous", paused: false, now }).boundary, "review_failure");
  assert.equal(planSafeNextAction({ request: request({ state: "completed" }), mode: "autonomous", paused: false, now }).classification, "terminal");
});

test("service persists modes privately, binds revisions, records receipts, and survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-autonomy-"));
  let current = request({ state: "approved", run: approvedRun() });
  const calls: CoordinatorAction[] = [];
  const actions = actionMap(async (action) => {
    calls.push(action);
    current = { ...current, updatedAt: current.updatedAt + 1, grounding: grounded, topology, plan };
    return current;
  });
  const collection = async (): Promise<LocalRequestCollection> => ({
    schemaVersion: 1, provenance: "local_observation", observedAt: current.updatedAt, requests: [current],
  });
  const service = new LocalAutonomyService(directory, collection, actions);
  service.start(60_000);
  await service.setProjectMode(current.projectId, { schemaVersion: 1, mode: "autonomous", confirmBroaderAutomation: true });
  const result = await service.advance(current.id, { schemaVersion: 1, expectedUpdatedAt: current.updatedAt });
  assert.equal(result.outcome, "advanced");
  assert.equal(result.receipt?.action, "ground_request");
  assert.deepEqual(calls, ["ground_request"]);
  await assert.rejects(
    () => service.advance(current.id, { schemaVersion: 1, expectedUpdatedAt: now }),
    (error: unknown) => error instanceof LocalAutonomyError && error.code === "stale_revision"
  );
  service.stop();
  const restarted = new LocalAutonomyService(directory, collection, actions);
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.preferences[0]?.mode, "autonomous");
  assert.equal(snapshot.receipts.length, 1);
  assert.equal(snapshot.leases.length, 0);
  const raw = await readFile(join(directory, "autonomy-state.json"), "utf8");
  assert.equal(raw.includes("Build a live work coordinator"), false);
});

test("service denies broader unconfirmed modes and request overrides above project policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-autonomy-policy-"));
  const current = request();
  const collection = async (): Promise<LocalRequestCollection> => ({ schemaVersion: 1, provenance: "local_observation", observedAt: now, requests: [current] });
  const service = new LocalAutonomyService(directory, collection, actionMap(async () => current));
  await assert.rejects(() => service.setProjectMode(current.projectId, { schemaVersion: 1, mode: "autonomous", confirmBroaderAutomation: false }));
  await assert.rejects(() => service.setRequestMode(current.id, { schemaVersion: 1, mode: "balanced", confirmBroaderAutomation: true }));
  const paused = await service.setProjectPaused(current.projectId, { schemaVersion: 1, paused: true });
  assert.equal(paused.snapshot.preferences[0]?.paused, true);
});

function actionMap(run: (action: CoordinatorAction) => Promise<LocalRequest>): LocalAutonomyActions {
  return {
    ground_request: () => run("ground_request"),
    claim_lease: () => run("claim_lease"),
    checkpoint_lease: () => run("checkpoint_lease"),
    release_lease: () => run("release_lease"),
    prepare_execution: () => run("prepare_execution"),
    start_execution: () => run("start_execution"),
    validate_execution: () => run("validate_execution"),
    reconcile_execution: () => run("reconcile_execution"),
    reconcile_expired_lease: () => run("reconcile_expired_lease"),
  };
}
function approvedRun() {
  return {
    state: "approved" as const,
    contract: { schemaVersion: 1 as const, id: "contract_0123456789abcdef0123", digest: "e".repeat(64), requestId: "request_0123456789abcdef0123", projectId: "project_0123456789abcdef", outcome: "Build coordinator.", policy: "zero_effect" as const, allowedEffects: [] as [], maximumCostUsd: 0 as const, checks: ["npm test"], approvedAt: now },
    lease: null,
    events: [{ sequence: 1, type: "contract_approved" as const, observedAt: now, detail: "Approved." }],
  };
}
function approvedPlan() {
  return { ...plan, state: "approved" as const, approval: { digest: "f".repeat(64), revision: 1, approvedAt: now, policy: "zero_effect" as const, executionAuthorized: false as const } };
}
function authorizedExecution() {
  return {
    schemaVersion: 1 as const, state: "authorized" as const,
    authority: {
      schemaVersion: 1 as const,
      id: "authority_0123456789abcdef0123",
      digest: "1".repeat(64),
      requestId: "request_0123456789abcdef0123",
      projectId: "project_0123456789abcdef",
      planDigest: "d".repeat(64),
      planRevision: 1,
      planApprovalDigest: "f".repeat(64),
      groundingDigest: grounded.digest,
      topologyDigest: topology.digest,
      preflight: {
        schemaVersion: 1 as const,
        provenance: "bounded_git_observation" as const,
        digest: "4".repeat(64),
        observedAt: now,
        baseline: "5".repeat(40),
        branch: "main",
        clean: true as const,
        repositoryRootMatched: true as const,
        gitAvailable: true as const,
        limitations: ["Bounded Git observation."],
      },
      manifest: {
        schemaVersion: 1 as const,
        digest: "6".repeat(64),
        planDigest: "d".repeat(64),
        baseline: "5".repeat(40),
        order: ["task_0123456789ab"],
        tasks: [{ id: "task_0123456789ab", title: "Implement", allowedFiles: ["src/index.ts"], dependsOn: [], checks: ["npm test"] }],
        allowedEffects: ["create_isolated_worktree"] as ["create_isolated_worktree"],
        excludedEffects: ["canonical_worktree_write", "network", "provider", "credential", "paid_usage", "publish", "deploy"] as ["canonical_worktree_write", "network", "provider", "credential", "paid_usage", "publish", "deploy"],
        maximumCostUsd: 0 as const,
      },
      isolationProfile: "native_bounded_worktree" as const,
      maximumCostUsd: 0 as const,
      authorizedAt: now,
      expiresAt: now + 60_000,
    },
    workspace: null, run: null, patch: null, changeSet: null, proposal: null, commit: null, integration: null,
  };
}
function proposalPrompt() {
  return {
    schemaVersion: 1 as const, provenance: "bounded_local_coding_prompt" as const, digest: "2".repeat(64), authorityDigest: "1".repeat(64), runDigest: "3".repeat(64),
    taskId: "task_0123456789ab", system: "Return JSON.", instruction: "Implement.",
    sources: [{ path: "README.md", digest: "b".repeat(64), bytes: 5, content: "Guide" }],
    allowedPaths: ["src/index.ts"], responseContract: "pipeline_studio_change_proposal_v1" as const, maximumCostUsd: 0 as const,
  };
}
function executionRun() {
  return {
    schemaVersion: 1 as const,
    id: "execution_0123456789abcdef0123",
    digest: "7".repeat(64),
    state: "passed" as const,
    authorityDigest: "1".repeat(64),
    manifestDigest: "6".repeat(64),
    workspaceRef: "workspace_0123456789abcdef0123",
    baseline: "5".repeat(40),
    maximumCostUsd: 0 as const,
    startedAt: now,
    completedAt: now,
    attempts: [],
    changes: null,
  };
}
