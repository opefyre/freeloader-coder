import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectExecutionCoordinator } from "../apps/core/src/project-execution-coordinator.js";
import { ProjectExecutionService } from "../apps/core/src/project-execution-service.js";
import { ProjectLifecycleService } from "../apps/core/src/project-lifecycle-service.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_abcdef0123456789";
const planDigest = "d".repeat(64);
const evidence = "e".repeat(64);
const taskId = "plan_0000000000000004";

test("owner MVP advances approved major work through Jira-backed execution to durable completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "owner-mvp-e2e-"));
  let now = 100;
  try {
    const lifecycle = new ProjectLifecycleService(root);
    const begun = await lifecycle.begin({ projectId, mission: "Build a complete owner product.", now: now++ });
    const context = await lifecycle.publishQuestions({ projectId, now: now++, artifact: artifact("context", "a"), questions: [] });
    const eligible = await lifecycle.assess(projectId, { schemaVersion: 1, expectedRevision: context.revision, requestId: "request_abcdef01234567890123", projectKind: "new_product", affectedDomains: ["frontend", "backend"], deliveryStages: ["research", "product", "design", "frontend", "backend", "qa", "launch"], estimatedDeveloperHours: 120, requiresArchitectureDecision: true, evidence: ["The owner requested a complete multi-stage product."], confidence: 0.98 }, "owner-e2e-eligibility");
    assert.equal(eligible.decision.eligible, true);
    const solution = artifact("solution", "b");
    const awaiting = await lifecycle.publishSolution(projectId, solution);
    await lifecycle.decideSolution(projectId, { schemaVersion: 1, expectedRevision: awaiting.revision, artifactDigest: solution.digest, decision: "approved", feedback: null }, "owner-e2e-approval");
    const backlog = artifact("backlog", "c");
    await lifecycle.publishBacklog(projectId, backlog);
    await lifecycle.activateDelivery(projectId, backlog.digest, "PIPE-1");

    const plan = completeDeliveryPlan();
    const reviewedPlan = { ...plan, revision: 1, reviews: [{ schemaVersion: 1 as const, reviewerId: "delivery-reviewer", discipline: "delivery" as const, verdict: "pass" as const, findings: [] }, { schemaVersion: 1 as const, reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: [] }] };
    const execution = new ProjectExecutionService(root, { readDraft: async () => ({ draft: reviewedPlan, document: { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest: planDigest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => now, lifecycle);
    const worker = {
      tick: async () => {
        const candidate = { providerId: "groq", modelId: "coder", deviceId: "provider:groq", capabilities: ["chat", "structured_output", "tool_calling"], privacyClasses: ["source_code" as const], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 1_000, deviceLoad: 0.1, preference: 10 };
        const claim = await execution.claim(projectId, "worker", [candidate]);
        const lease = claim.task!.lease!;
        await execution.recordImplementation(projectId, taskId, lease.leaseId, "worker", evidence);
        await execution.recordValidation(projectId, taskId, lease.leaseId, "worker", { tier: "fast", commandLabel: "fast", passed: true, exitCode: 0, evidenceDigest: evidence });
        await execution.recordValidation(projectId, taskId, lease.leaseId, "worker", { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: evidence });
        await execution.recordReviews(projectId, taskId, lease.leaseId, "worker", [review("functional", "gemini"), review("security", "cloudflare")]);
        await execution.recordIntegration(projectId, taskId, lease.leaseId, "worker", { commitDigest: "1".repeat(40), integrationDigest: "2".repeat(64), validation: { tier: "integration", commandLabel: "integration", passed: true, exitCode: 0, evidenceDigest: evidence } });
        return execution.get(projectId);
      },
    };
    await execution.initialize(projectId);
    const coordinator = new ProjectExecutionCoordinator(root, execution, worker, () => now++, 25, async (id) => { await lifecycle.completeDelivery(id); });
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    await coordinator.shutdown();

    assert.equal((await lifecycle.get(projectId))?.stage, "complete");
    assert.equal((await execution.get(projectId))?.state, "completed");
    assert.equal((await new ProjectLifecycleService(root).get(projectId))?.stage, "complete");
    assert.equal((await new ProjectExecutionService(root, { readDraft: async () => ({ draft: reviewedPlan, document: { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest: planDigest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => null }).get(projectId))?.state, "completed");
    assert.equal(begun.stage, "context_review");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function artifact(kind: "context" | "solution" | "backlog", character: string) {
  return { kind, projectRelativePath: kind === "context" ? ".pipeline/CONTEXT.md" as const : kind === "solution" ? ".pipeline/SOLUTION.md" as const : ".pipeline/BACKLOG.md" as const, digest: character.repeat(64), revision: 1, createdAt: 100, citations: ["local://evidence"], reviewerIds: kind === "context" ? ["context-reviewer"] : ["reviewer-one", "reviewer-two"], qaPassed: true as const };
}
function review(role: "functional" | "security", providerId: string) { return { reviewerId: `${providerId}-${role}`, providerId, role, verdict: "pass" as const, findings: [{ id: `${role}-pass`, severity: "info" as const, evidenceRef: evidence, confidence: 0.99, acceptanceCriterion: "Approved behavior is present.", recommendedRepair: "No repair required." }] }; }
async function waitFor(predicate: () => Promise<boolean>) { for (let index = 0; index < 100; index += 1) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error("Timed out waiting for owner MVP completion."); }
