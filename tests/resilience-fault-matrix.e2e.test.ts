import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { FreeProviderExecutionModel } from "../apps/core/src/free-provider-execution-model.js";
import { InfrastructureDeliveryService } from "../apps/core/src/infrastructure-delivery-service.js";
import { ProjectExecutionService } from "../apps/core/src/project-execution-service.js";
import { ProjectLifecycleCoordinator } from "../apps/core/src/project-lifecycle-coordinator.js";
import { ProjectLifecycleService } from "../apps/core/src/project-lifecycle-service.js";
import { ResilienceCertificationService, type DurableResilienceObservation } from "../apps/core/src/resilience-certification-service.js";
import { planJiraSync, verifyJiraSync } from "../packages/integrations/src/sync.js";
import { advanceProjectLifecycle, createProjectLifecycle, type ProjectLifecycleRecord } from "../packages/orchestration/src/project-lifecycle.js";
import { infrastructureDesignSchema, type InfrastructureAdapter } from "../packages/orchestration/src/infrastructure-delivery.js";
import type { DeliveryPlanDraft } from "../packages/orchestration/src/delivery-plan.js";
import type { ProviderAdapter } from "../packages/providers/src/adapter.js";
import type { ProviderConnection } from "../packages/schemas/src/index.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_abcdef0123456789";
const revision = "b".repeat(64);
const now = 1_800_000_000_000;

test("real owner-timeout, attachment, connector, and Jira-conflict paths preserve state and resume exactly once", async () => {
  const root = await mkdtemp(join(process.cwd(), ".codkesh-resilience-matrix-"));
  const state = join(root, "state");
  const evidence = new ResilienceCertificationService(state);
  try {
    await exerciseCrashAndStaleLease(root, evidence);
    await exerciseProviderRecovery(root, evidence);
    await exerciseReviewerDissent(root, evidence);
    await exerciseDeploymentRecovery(root, evidence);
    await exerciseOwnerTimeout(state, evidence);
    await exerciseInvalidAttachment(root, state, evidence);
    await exerciseJiraDenialAndConflict(evidence);

    const restarted = new ResilienceCertificationService(state);
    const observations = await restarted.list(projectId);
    assert.deepEqual(observations.map((item) => item.scenario).sort(), ["connector_denial", "deployment_failure", "free_provider_exhaustion", "invalid_attachment", "jira_conflict", "malformed_model_output", "owner_timeout", "process_crash", "provider_failure", "reviewer_dissent", "stale_lease"]);
    assert.equal(observations.every((item) => item.safeStatePreserved && item.resumed && item.duplicateEffects === 0), true);
    const certification = await restarted.certify(projectId);
    assert.equal(certification.certified, true);
    assert.deepEqual(certification.failures, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function exerciseReviewerDissent(root: string, evidence: ResilienceCertificationService) {
  const plan = completeDeliveryPlan();
  const reviewedPlan = {
    ...plan,
    revision: 1,
    reviews: [
      { schemaVersion: 1 as const, reviewerId: "delivery-reviewer", discipline: "delivery" as const, verdict: "pass" as const, findings: [] },
      { schemaVersion: 1 as const, reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: [] },
    ],
  };
  const planDigest = "d".repeat(64);
  const implementationDigest = "e".repeat(64);
  const repairedDigest = "f".repeat(64);
  const taskId = "plan_0000000000000004";
  const state = join(root, "reviewer-dissent");
  const service = executionService(state, reviewedPlan, planDigest, now);
  await service.initialize(projectId);
  const first = await service.claim(projectId, "worker-a", [executionCandidate()]);
  const firstLease = first.task!.lease!;
  await service.recordImplementation(projectId, taskId, firstLease.leaseId, "worker-a", implementationDigest);
  await service.recordValidation(projectId, taskId, firstLease.leaseId, "worker-a", validation("fast", implementationDigest));
  await service.recordValidation(projectId, taskId, firstLease.leaseId, "worker-a", validation("full", implementationDigest));
  const dissent = await service.recordReviews(projectId, taskId, firstLease.leaseId, "worker-a", [executionReview("functional-a", "gemini", "functional", "pass", implementationDigest), executionReview("design-a", "cloudflare", "design", "fail", implementationDigest)]);
  assert.equal(dissent.status, "quarantined");
  assert.equal(dissent.lease, null);
  const before = digestState(dissent.status, dissent.revision, dissent.reviews.map((item) => item.verdict).join("-"));
  const repaired = await service.authorizeReviewRepair(projectId, taskId, { approvalId: "approval_22222222222222222222", expectedRevision: dissent.revision, rationale: "Repair the independently observed design issue and rerun every gate." });
  assert.equal(repaired.status, "queued");
  assert.equal(repaired.reviewAttempts?.[0]?.reviews.some((item) => item.verdict === "fail"), true);

  const restarted = executionService(state, reviewedPlan, planDigest, now + 1);
  const second = await restarted.claim(projectId, "worker-b", [executionCandidate()]);
  const secondLease = second.task!.lease!;
  await restarted.recordImplementation(projectId, taskId, secondLease.leaseId, "worker-b", repairedDigest);
  await restarted.recordValidation(projectId, taskId, secondLease.leaseId, "worker-b", validation("fast", repairedDigest));
  await restarted.recordValidation(projectId, taskId, secondLease.leaseId, "worker-b", validation("full", repairedDigest));
  await restarted.recordReviews(projectId, taskId, secondLease.leaseId, "worker-b", [executionReview("functional-b", "gemini", "functional", "pass", repairedDigest), executionReview("design-b", "cloudflare", "design", "pass", repairedDigest)]);
  const completed = await restarted.recordIntegration(projectId, taskId, secondLease.leaseId, "worker-b", { commitDigest: "1".repeat(40), integrationDigest: "2".repeat(64), validation: { tier: "integration", commandLabel: "post integration", passed: true, exitCode: 0, evidenceDigest: repairedDigest } });
  assert.equal(completed.status, "completed");
  assert.equal(completed.reviewAttempts?.[0]?.reviews.some((item) => item.verdict === "fail"), true);
  await evidence.record(observation("reviewer_dissent", 8, before, digestState(completed.status, completed.revision, completed.integrationDigest), "An independent design reviewer rejected the implementation evidence.", "Approve a bounded repair that preserves the dissent and reruns every delivery gate."));
}

async function exerciseOwnerTimeout(state: string, evidence: ResilienceCertificationService) {
  const lifecycle = new ProjectLifecycleService(state);
  await lifecycle.begin({ projectId, mission: "Deliver the owner-approved product.", now });
  const context = await lifecycle.publishQuestions({ projectId, now: now + 1, artifact: artifact("context", "a"), questions: [] });
  await lifecycle.assess(projectId, { schemaVersion: 1, expectedRevision: context.revision, requestId: "request_aaaaaaaaaaaaaaaaaaaa", projectKind: "new_product", affectedDomains: ["product", "frontend", "backend"], deliveryStages: ["research", "product", "design", "frontend", "backend", "qa", "launch"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, evidence: ["Complete product work requested."], confidence: 1 }, "matrix-owner-timeout-eligibility");
  const solution = artifact("solution", "b");
  const waiting = await lifecycle.publishSolution(projectId, solution);
  assert.equal(waiting.stage, "awaiting_design_approval");
  const before = digestState(waiting.stage, waiting.revision);
  const restarted = new ProjectLifecycleService(state);
  const stillWaiting = await restarted.get(projectId);
  assert.equal(stillWaiting?.stage, "awaiting_design_approval");
  const approved = await restarted.decideSolution(projectId, { schemaVersion: 1, expectedRevision: waiting.revision, artifactDigest: solution.digest, decision: "approved", feedback: null }, "matrix-owner-timeout-approval");
  const replay = await restarted.decideSolution(projectId, { schemaVersion: 1, expectedRevision: waiting.revision, artifactDigest: solution.digest, decision: "approved", feedback: null }, "matrix-owner-timeout-approval");
  assert.equal(replay.revision, approved.revision);
  await evidence.record(observation("owner_timeout", 10, before, digestState(approved.stage, approved.revision), "Owner approval remained pending across restart.", "Approve, decline, or request a revision."));
}

async function exerciseDeploymentRecovery(root: string, evidence: ResilienceCertificationService) {
  const requestId = "request_cccccccccccccccccccc";
  const design = infrastructureDesignSchema.parse({ schemaVersion: 1, projectId, requestId, contextDigest: "a".repeat(64), solutionDigest: "b".repeat(64), approvedSolutionDigest: "b".repeat(64), environments: [{ name: "preview", purpose: "Disposable recovery proof.", promotionFrom: null }], topology: ["Static edge preview."], services: [{ name: "web", purpose: "Serve preview.", runtime: "Edge", dependencies: [] }], resources: [{ provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "preview", region: "global", kind: "pages", freeTierVerifiedAt: now, billingEnabled: false, promotionalCreditOnly: false, evidence: ["Verified free account."] }], infrastructureAsCode: ["infra/wrangler.jsonc"], secrets: [{ purpose: "Deploy preview.", reference: "vault://projects/test/cloudflare", consumers: ["adapter"] }], networking: ["HTTPS edge."], dataAndBackups: ["No persistent data."], observability: ["Provider and HTTP checks."], deployment: ["Approved artifact only."], rollback: ["Delete exact failed deployment."], runbook: ["Retry only after rollback is verified."], alternatives: [{ option: "Pages", decision: "Free reversible preview.", citations: ["provider://cloudflare"] }], citations: ["local://DESIGN.md"] });
  const previewInput = { schemaVersion: 1 as const, requestId, provider: "Cloudflare", accountId: "account-test", projectOrTenantId: "codkesh-test", resourceId: "preview", region: "global", action: "deploy" as const, permissions: ["pages:write"], maximumCostUsd: 0 as const, reversible: true, rollbackAction: "Delete exact deployment and verify absence." };
  let healthy = false;
  let applies = 0;
  let rollbacks = 0;
  const adapter: InfrastructureAdapter = {
    apply: async () => { applies += 1; return { providerOperationId: `operation-${applies}`, endpoint: "https://preview.example.test", evidence: ["Applied."] }; },
    verify: async () => [{ name: "http", passed: healthy, evidence: healthy ? "Healthy." : "Unhealthy." }],
    rollback: async () => { rollbacks += 1; return "Exact deployment removed."; },
  };
  const state = join(root, "deployment-recovery");
  const service = new InfrastructureDeliveryService(state, new Map([["Cloudflare", adapter]]), () => now);
  await service.publishDesign(projectId, design, "matrix-deployment-design");
  const failedPreview = await service.preview(projectId, previewInput, "matrix-deployment-preview-failed");
  await service.approve(projectId, failedPreview.id, "matrix-deployment-approval-failed");
  const rolledBack = await service.execute(projectId, failedPreview.id, "matrix-deployment-execute-failed");
  assert.equal(rolledBack.state, "rolled_back");
  assert.equal(rollbacks, 1);
  healthy = true;
  const recoveredPreview = await service.preview(projectId, previewInput, "matrix-deployment-preview-recovered");
  await service.approve(projectId, recoveredPreview.id, "matrix-deployment-approval-recovered");
  const verified = await service.execute(projectId, recoveredPreview.id, "matrix-deployment-execute-recovered");
  assert.equal(verified.state, "verified");
  const restarted = new InfrastructureDeliveryService(state, new Map([["Cloudflare", adapter]]), () => now + 1);
  assert.deepEqual(await restarted.execute(projectId, recoveredPreview.id, "matrix-deployment-execute-recovered"), verified);
  assert.equal(applies, 2);
  await evidence.record(observation("deployment_failure", 9, digestState(rolledBack.providerOperationId, rolledBack.state), digestState(verified.providerOperationId, verified.state), "Deployment verification failed and triggered exact rollback.", "Correct the deployment condition and approve a new preview."));
}

async function exerciseProviderRecovery(root: string, evidence: ResilienceCertificationService) {
  const connection = providerConnection();
  let current = connection;
  let mode: "fail" | "malformed" | "success" = "fail";
  let successfulEffects = 0;
  const repository = { list: async () => [current], read: async (id: string) => id === current.id ? current : null };
  const adapters = { adapter: () => ({ manifest: { providerId: "groq" }, chat: async (_credential: unknown, request: { requestId: string; modelId: string }) => {
    if (mode === "fail") throw Object.assign(new Error("provider unavailable"), { status: 503, code: "provider_unavailable" });
    if (mode === "malformed") return providerResponse(request, "not-json");
    successfulEffects += 1;
    return providerResponse(request, JSON.stringify({ summary: "Recovered bounded work", operations: [] }));
  } }) as unknown as ProviderAdapter };
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: now - 1, expiresAt: now + 60_000 };
  const input = (taskId: string) => ({ projectId, taskId, assignment: { providerId: "groq", modelId: current.modelId, deviceId: `provider:${current.id}` }, role: "implementer" as const, permit, system: "Return JSON.", instruction: "Produce one bounded proposal.", sources: [{ name: "src/app.ts", content: "export const safe = true;" }], responseSchema: { type: "object" } });
  const providerRoot = join(root, "provider-recovery");
  const failing = new FreeProviderExecutionModel(providerRoot, repository, { read: async () => "test-credential" }, adapters, () => now);
  await assert.rejects(() => failing.run(input("plan_1000000000000000")), /provider unavailable|did not complete|canonical task is preserved/i);
  mode = "success";
  const restarted = new FreeProviderExecutionModel(providerRoot, repository, { read: async () => "test-credential" }, adapters, () => now + 1);
  assert.equal((await restarted.run(input("plan_1000000000000001"))).providerId, "groq");
  assert.equal(successfulEffects, 1);
  await evidence.record(observation("provider_failure", 2, digestState("provider_unavailable"), digestState("recovered", successfulEffects), "The assigned free provider returned an unavailable response.", "Retry through a healthy eligible free provider."));

  mode = "malformed";
  await assert.rejects(() => restarted.run(input("plan_2000000000000000")), /malformed|did not complete|invalid|canonical task is preserved/i);
  mode = "success";
  assert.equal((await new FreeProviderExecutionModel(providerRoot, repository, { read: async () => "test-credential" }, adapters, () => now + 2).run(input("plan_2000000000000001"))).providerId, "groq");
  assert.equal(successfulEffects, 2);
  await evidence.record(observation("malformed_model_output", 4, digestState("not-json"), digestState("valid-json", successfulEffects), "The provider returned output outside the required JSON contract.", "Retry with the same bounded schema on an eligible provider."));

  current = providerConnection({ quota: { ...connection.quota, remainingRequests: 0, resetAt: now + 30_000 } });
  const exhausted = new FreeProviderExecutionModel(join(root, "provider-exhaustion"), repository, { read: async () => "test-credential" }, adapters, () => now);
  assert.equal((await exhausted.candidates(permit, "implementer")).length, 0);
  current = connection;
  const afterReset = new FreeProviderExecutionModel(join(root, "provider-exhaustion"), repository, { read: async () => "test-credential" }, adapters, () => now + 30_000);
  assert.equal((await afterReset.run(input("plan_3000000000000001"))).providerId, "groq");
  assert.equal(successfulEffects, 3);
  await evidence.record(observation("free_provider_exhaustion", 3, digestState("remaining", 0), digestState("remaining", current.quota.remainingRequests), "The free request allowance was exhausted before dispatch.", "Wait for the observed free-tier reset, then resume."));
}

async function exerciseCrashAndStaleLease(root: string, evidence: ResilienceCertificationService) {
  const lifecycle = lifecycleAtSolution(projectId, now);
  const actionId = `${projectId}:solution:revision-${lifecycle.revision}`;
  const effects = new Set<string>();
  let calls = 0;
  const crashState = join(root, "crash-coordinator");
  const crashed = new ProjectLifecycleCoordinator(crashState, lifecycleSource(lifecycle), lifecycleWorkers(async (_id, id) => {
    calls += 1;
    effects.add(id);
    if (calls === 1) throw new Error("simulated crash after durable side effect");
  }), "crash-worker", () => now);
  await assert.rejects(() => crashed.reconcile(projectId), /simulated crash/);
  const restarted = new ProjectLifecycleCoordinator(crashState, lifecycleSource(lifecycle), lifecycleWorkers(async (_id, id) => { calls += 1; effects.add(id); }), "restarted-worker", () => now + 1);
  assert.equal(await restarted.reconcile(projectId), "dispatched");
  assert.equal(effects.size, 1);
  assert.equal(calls, 2);
  await evidence.record(observation("process_crash", 0, digestState("dispatched", actionId), digestState("completed", actionId), "The process stopped after the idempotent side effect.", "Restart Codkesh; it replays the same action identity."));

  const leaseState = join(root, "lease-coordinator");
  const priming = new ProjectLifecycleCoordinator(leaseState, lifecycleSource(lifecycle), lifecycleWorkers(async () => undefined), "prime-worker", () => now, 10);
  assert.equal(await priming.reconcile(projectId), "dispatched");
  const checkpointPath = join(leaseState, "project-lifecycle-coordinator", `${projectId}.json`);
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  checkpoint.dispatches[actionId].state = "completed";
  await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8");
  const lock = join(leaseState, "project-lifecycle-leases", `${projectId}.lock`);
  await mkdir(lock, { recursive: true });
  const token = "00000000-0000-4000-8000-000000000000";
  await writeFile(join(lock, "owner.json"), JSON.stringify({ token, ownerId: "crashed-worker", acquiredAt: 0, expiresAt: 1 }), "utf8");
  await writeFile(join(lock, `heartbeat-${token}.json`), JSON.stringify({ at: 1 }), "utf8");
  const recovered = new ProjectLifecycleCoordinator(leaseState, lifecycleSource(lifecycle), lifecycleWorkers(async () => { throw new Error("completed work must not redispatch"); }), "lease-recovery", () => now + 100, 10);
  assert.equal(await recovered.reconcile(projectId), "checkpointed");
  const recoveredState = await recovered.get(projectId);
  assert.equal(recoveredState.events.some((event) => event.type === "lease_recovered"), true);
  await evidence.record(observation("stale_lease", 1, digestState(token, "expired"), digestState(actionId, "checkpointed"), "A stale worker lease remained after completed work.", "Recover the expired lease and retain the completed checkpoint."));
}

async function exerciseInvalidAttachment(root: string, state: string, evidence: ResilienceCertificationService) {
  const repository = join(root, "attachment-project");
  await mkdir(join(repository, ".git"), { recursive: true });
  await writeFile(join(repository, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await writeFile(join(repository, "README.md"), "# Attachment project\n", "utf8");
  const registry = new LocalProjectRegistry(state);
  const registered = await registry.register({ schemaVersion: 1, path: repository, displayName: "Attachment project" });
  const before = digestState((await registry.list()).projects.length, (await readFile(join(repository, "README.md"), "utf8")).length);
  await assert.rejects(() => registry.addFiles(registered.id, { schemaVersion: 1, paths: [repository] }), /Folders and symbolic links/);
  assert.equal((await registry.list()).projects.length, 1);
  const valid = join(root, "brief.md");
  await writeFile(valid, "# Valid brief\n", "utf8");
  const restarted = new LocalProjectRegistry(state);
  const imported = await restarted.addFiles(registered.id, { schemaVersion: 1, paths: [valid] });
  assert.equal(imported.files.length, 1);
  assert.equal(await readFile(join(repository, imported.files[0]!.projectRelativePath), "utf8"), "# Valid brief\n");
  await evidence.record(observation("invalid_attachment", 7, before, digestState(imported.files[0]!.evidence.sourceDigest, imported.files.length), "A folder was rejected before it entered project evidence.", "Choose a regular supported file."));
}

async function exerciseJiraDenialAndConflict(evidence: ResilienceCertificationService) {
  const base = { issueId: "10079", issueKey: "PIPE-79", sourceRevision: revision, currentRevision: revision, requestedStatus: "Done" as const, comment: "Deterministic checks and review passed.", links: ["https://github.com/opefyre/codkesh/commit/abc"], evidence: { deterministicChecksPassed: true, reviewQuorumPassed: true, modelClaimOnly: false }, permissionState: "ready" as const, existingReceipts: [] };
  const denied = planJiraSync({ ...base, permissionState: "revoked" });
  assert.equal(denied.state, "permission_denied");
  const permitted = planJiraSync(base);
  assert.equal(permitted.state, "ready");
  await evidence.record(observation("connector_denial", 5, digestState(denied.state), digestState(permitted.state), "Jira permission was revoked before synchronization.", "Reconnect Jira and retry the unchanged plan."));

  const conflict = planJiraSync({ ...base, currentRevision: "d".repeat(64) });
  assert.equal(conflict.state, "conflict");
  const ready = planJiraSync(base);
  assert.equal(ready.state, "ready");
  const receipt = verifyJiraSync({ marker: ready.marker, issueId: base.issueId, expectedFields: ready.changes, observedFields: ready.changes, observedRevision: "e".repeat(64), matchingMarkers: 1, now });
  const replay = planJiraSync({ ...base, existingReceipts: [receipt] });
  assert.equal(replay.state, "already_verified");
  await evidence.record(observation("jira_conflict", 6, digestState(conflict.state, conflict.decision), digestState(receipt.marker, receipt.observedRevision), "Jira changed after the planned source revision.", "Review the latest Jira revision and retry."));
}

function observation(scenario: DurableResilienceObservation["scenario"], index: number, beforeDigest: string, afterDigest: string, blocker: string, smallestOwnerAction: string): DurableResilienceObservation {
  return { schemaVersion: 1, projectId, requestId: `request_${index.toString(16).padStart(20, "0")}`, scenario, evidenceRef: `event:matrix/${scenario}`, beforeDigest, afterDigest, recoveryReceipt: `receipt:matrix/${scenario}`, safeStatePreserved: true, blocker, smallestOwnerAction, restartObserved: true, resumed: true, duplicateEffects: 0, observedAt: now + index };
}

function artifact(kind: "context" | "solution", character: string) {
  return { kind, projectRelativePath: kind === "context" ? ".pipeline/CONTEXT.md" as const : ".pipeline/SOLUTION.md" as const, digest: character.repeat(64), revision: 1, createdAt: now, citations: ["local://evidence"], reviewerIds: kind === "context" ? ["context-reviewer"] : ["product-reviewer", "technical-reviewer"], qaPassed: true as const };
}

function digestState(...values: unknown[]) {
  return (values.map((value) => String(value)).join("").padEnd(64, "0").slice(0, 64).replaceAll(/[^a-f0-9]/g, "a"));
}

function lifecycleAtSolution(id: string, at: number): ProjectLifecycleRecord {
  let record = createProjectLifecycle({ projectId: id, mission: "Build a complete product.", now: at });
  record = advanceProjectLifecycle(record, { type: "begin_context_review" }, at + 1);
  return advanceProjectLifecycle(record, { type: "scope_assessed", assessment: { classification: "new_product", rationale: ["Major product"], affectedDomains: ["product"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, confidence: 1 } }, at + 2);
}

function lifecycleSource(record: ProjectLifecycleRecord) {
  return { get: async (id: string) => id === record.projectId ? record : null, list: async () => [record] };
}

function lifecycleWorkers(run: (projectId: string, actionId: string) => Promise<unknown>) {
  return { solution: run, deliveryPlan: run, execution: run };
}

function providerConnection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    schemaVersion: 1,
    id: "connection-groq-matrix",
    providerId: "groq",
    modelId: "openai/gpt-oss-120b",
    apiBaseUrl: "https://api.groq.com/openai/v1",
    credentialReference: "vault:providers/groq/matrix",
    credentialFingerprint: "012345abcdef",
    credentialState: "active",
    state: "ready",
    privacyClass: "training_eligible",
    capabilityRoles: ["implementer", "reviewer"],
    contextWindowTokens: 131_072,
    maxOutputTokens: 65_536,
    cost: { access: "account_limited_free", plan: "Free", zeroCost: true, billingEnabled: false, observedAt: now - 1, expiresAt: now + 120_000, source: "account_api" },
    quota: { source: "account_api", observedAt: now - 1, expiresAt: now + 120_000, requestsPerMinute: 5, requestsPerDay: 100, tokensPerMinute: 30_000, tokensPerDay: 1_000_000, remainingRequests: 90, remainingTokens: 900_000, resetAt: now + 30_000 },
    canary: { status: "passed", observedAt: now - 1, expiresAt: now + 120_000, modelId: "openai/gpt-oss-120b", capabilities: ["chat", "structured_output"], inputTokens: 1, outputTokens: 1, failureCode: null },
    updatedAt: now - 1,
    ...overrides,
  };
}

function providerResponse(request: { requestId: string; modelId: string }, content: string) {
  return { schemaVersion: 1 as const, providerId: "groq", modelId: request.modelId, requestId: request.requestId, content, finishReason: "stop" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: false, extensions: [] }, toolCalls: [], extensions: [], verified: false };
}

function executionService(root: string, plan: DeliveryPlanDraft, planDigest: string, at: number) {
  return new ProjectExecutionService(
    root,
    { readDraft: async () => ({ draft: plan, document: { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest: planDigest, markdown: "# Plan", itemCount: plan.items.length } }) },
    { get: async () => ({ completed: true, planDigest, issues: { plan_0000000000000004: { issueKey: "PIPE-4" } } }) },
    () => at,
    { eligibility: async () => ({ schemaVersion: 1 as const, projectId, requestId: "request_eeeeeeeeeeeeeeeeeeee", eligible: true, assessment: { classification: "major_feature" as const, rationale: ["Multi-stage feature."], affectedDomains: ["frontend", "backend"], estimatedDeveloperHours: 24, requiresArchitectureDecision: true, confidence: 1 }, evidence: ["Owner-approved product work."], alternatives: [], override: null, decidedAt: at }) },
  );
}

function executionCandidate() {
  return { providerId: "groq", modelId: "coder", deviceId: "spare-mac", capabilities: ["chat", "structured_output", "tool_calling"], privacyClasses: ["source_code" as const], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 4_000, deviceLoad: 0.2, preference: 10 };
}

function validation(tier: "fast" | "full", evidenceDigest: string) {
  return { tier, commandLabel: tier === "fast" ? "typecheck" : "full verification", passed: true, exitCode: 0, evidenceDigest };
}

function executionReview(reviewerId: string, providerId: string, role: "functional" | "design", verdict: "pass" | "fail", evidenceRef: string) {
  return { reviewerId, providerId, role, verdict, findings: [{ id: `${role}-${verdict}`, severity: verdict === "pass" ? "info" as const : "major" as const, evidenceRef, confidence: 0.99, acceptanceCriterion: "The approved behavior and product design must be implemented and independently verified.", recommendedRepair: verdict === "pass" ? "No repair is required." : "Correct the design mismatch and rerun validation and review." }] };
}
