import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectExecutionService } from "../apps/core/src/project-execution-service.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_abcdef0123456789";
const digest = "d".repeat(64);
const evidence = "e".repeat(64);
const taskId = "plan_0000000000000004";
const plan = completeDeliveryPlan();
const draft = { ...plan, revision: 1, reviews: [{ schemaVersion: 1 as const, reviewerId: "delivery-reviewer", discipline: "delivery" as const, verdict: "pass" as const, findings: [] }, { schemaVersion: 1 as const, reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: [] }] };
const candidate = { providerId: "groq", modelId: "coder", deviceId: "spare-mac", capabilities: ["chat", "structured_output", "tool_calling"], privacyClasses: ["source_code" as const], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 4_000, deviceLoad: 0.2, preference: 10 };

test("durable execution enforces one lease, ordered validation, independent quorum, and restart evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-service-"));
  let now = 100;
  try {
    const service = makeService(root, () => now);
    const initialized = await service.initialize(projectId);
    assert.equal(initialized.tasks.length, 1);
    const first = await service.claim(projectId, "worker-a", [candidate]);
    assert.equal(first.task?.status, "running");
    assert.equal((await service.claim(projectId, "worker-b", [candidate])).task, null);
    const lease = first.task!.lease!;
    await assert.rejects(() => service.heartbeat(projectId, taskId, lease.leaseId, "worker-b"), /current unexpired lease owner/);
    now += 1;
    await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    await assert.rejects(() => service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "full", commandLabel: "full checks", passed: true, exitCode: 0, evidenceDigest: evidence }), /requires passing fast/);
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: true, exitCode: 0, evidenceDigest: evidence });
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "full", commandLabel: "full verification", passed: true, exitCode: 0, evidenceDigest: evidence });
    const reviewed = await service.recordReviews(projectId, taskId, lease.leaseId, "worker-a", [review("functional-reviewer", "gemini", "functional"), review("design-reviewer", "cloudflare", "design")]);
    assert.equal(reviewed.status, "integrating");
    await assert.rejects(() => service.recordIntegration(projectId, taskId, lease.leaseId, "worker-a", { commitDigest: evidence, integrationDigest: evidence, validation: { tier: "integration", commandLabel: "post integration", passed: false, exitCode: 1, evidenceDigest: evidence } }), /must pass/);
    const completed = await service.recordIntegration(projectId, taskId, lease.leaseId, "worker-a", { commitDigest: evidence, integrationDigest: evidence, validation: { tier: "integration", commandLabel: "post integration", passed: true, exitCode: 0, evidenceDigest: evidence } });
    assert.equal(completed.status, "completed");
    assert.equal((await service.get(projectId))?.state, "completed");
    const restarted = makeService(root, () => 200);
    assert.equal((await restarted.get(projectId))?.tasks[0]?.status, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed validation permits only bounded healing and expired outcomes require owner review", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-healing-"));
  let now = 100;
  try {
    const service = makeService(root, () => now);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate], 10_000);
    const lease = claimed.task!.lease!;
    await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: false, exitCode: 1, evidenceDigest: evidence });
    const healed = await service.assessHealing(projectId, taskId, lease.leaseId, "worker-a", { failureClass: "implementation", changedFiles: ["src/app.ts"], policy: { maxAttempts: 2, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["typecheck", "test"], requiredReviewRoles: ["functional", "design"], minimumGoldenScore: 90 }, goldenScore: 95, previousGoldenScore: 95 });
    assert.equal(healed.status, "healing");
    assert.equal(healed.attempt, 1);
    now = lease.expiresAt + 1;
    const reconciled = await service.reconcileExpired(projectId);
    assert.equal(reconciled[0]?.status, "needs_user");
    assert.equal((await service.get(projectId))?.state, "needs_user");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function makeService(root: string, now: () => number) {
  return new ProjectExecutionService(root, { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, now);
}
function review(reviewerId: string, providerId: string, role: "functional" | "design") { return { reviewerId, providerId, role, verdict: "pass" as const, findings: [{ id: `${role}-finding`, severity: "info" as const, evidenceRef: evidence, confidence: 0.99, acceptanceCriterion: "The approved behavior is implemented and verified.", recommendedRepair: "No repair is required." }] }; }
