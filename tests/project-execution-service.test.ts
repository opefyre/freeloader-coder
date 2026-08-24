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
const eligibility = { eligibility: async () => ({ schemaVersion: 1 as const, projectId, requestId: "request_0123456789abcdef0123", eligible: true, assessment: { classification: "major_feature" as const, rationale: ["Multi-stage feature."], affectedDomains: ["frontend", "backend"], estimatedDeveloperHours: 24, requiresArchitectureDecision: true, confidence: 1 }, evidence: ["Approved major feature."], alternatives: [], override: null, decidedAt: 1 }) };

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

test("execution initialization requires eligibility before reading delivery effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-eligibility-"));
  let planReads = 0;
  const plans = { readDraft: async () => { planReads += 1; return { draft, document: { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest, markdown: "# Plan", itemCount: 4 } }; } };
  const jira = { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) };
  await assert.rejects(() => new ProjectExecutionService(root, plans, jira, () => 100).initialize(projectId), /eligibility authority/i);
  assert.equal(planReads, 0);
});

test("execution initialization preserves an expired eligibility decision while its assessed scope is current", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-current-eligibility-"));
  try {
    const plans = { readDraft: async () => ({ draft, document: { schemaVersion: 1 as const, projectId, projectRelativePath: ".pipeline/BACKLOG.md" as const, revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) };
    const jira = { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) };
    const service = new ProjectExecutionService(root, plans, jira, () => 100_000_000, {
      eligibility: async () => ({ ...(await eligibility.eligibility()), decidedAt: 1 }),
    });
    const initialized = await service.initialize(projectId);
    assert.equal(initialized.state, "running");
    assert.equal(initialized.tasks.length, 1);
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

test("owner can resume a pre-implementation environment failure after repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-environment-retry-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    const interrupted = await service.interrupt(projectId, taskId, lease.leaseId, "worker-a", "The new repository has no baseline commit.");
    const retried = await service.authorizeEnvironmentRetry(projectId, {
      taskId,
      expectedRevision: interrupted.revision,
      rationale: "The verified repository baseline repair is installed.",
    });
    assert.equal(retried.status, "queued");
    assert.equal(retried.assignment, null);
    assert.equal((await service.get(projectId))?.state, "running");
    await assert.rejects(() => service.authorizeEnvironmentRetry(projectId, { taskId, expectedRevision: interrupted.revision, rationale: "Retry this repaired environment once more." }), /evidence changed/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owner can resume preserved pre-review evidence after repairing the execution runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-runtime-retry-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    const failed = await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: false, exitCode: 127, evidenceDigest: evidence });
    await service.assessHealing(projectId, taskId, lease.leaseId, "worker-a", { failureClass: "implementation", changedFiles: ["src/app.ts"], policy: { maxAttempts: 2, allowedFiles: ["src/app.ts"], protectedPaths: [".env"], requiredChecks: ["typecheck"], requiredReviewRoles: ["functional", "security"], minimumGoldenScore: 90 }, goldenScore: 100, previousGoldenScore: 100 });
    const interrupted = await service.interrupt(projectId, taskId, lease.leaseId, "worker-a", "Dependency preparation was unavailable.");
    const retried = await service.authorizeEnvironmentRetry(projectId, { taskId, expectedRevision: interrupted.revision, rationale: "Verified dependency preparation is installed." });
    assert.equal(retried.status, "queued");
    assert.equal(retried.implementationEvidence.length, 1, "preserved evidence is not erased");
    assert.equal(retried.validations.length, 1, "failed evidence remains auditable");
    assert.equal(failed.failureClass, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("protected paths are rejected before execution and reviewer dissent cannot integrate", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-guards-"));
  try {
    const protectedDraft = { ...draft, items: draft.items.map((item) => item.id === taskId ? { ...item, allowedFiles: [".env.production"] } : item) };
    const protectedService = new ProjectExecutionService(root, { readDraft: async () => ({ draft: protectedDraft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => 100, eligibility);
    await assert.rejects(() => protectedService.initialize(projectId), /protected credential, environment, or Git path/);

    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    const implemented = await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    assert.equal(implemented.status, "validating", "model implementation evidence alone cannot complete work");
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: true, exitCode: 0, evidenceDigest: evidence });
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: evidence });
    const dissent = await service.recordReviews(projectId, taskId, lease.leaseId, "worker-a", [review("functional-reviewer", "gemini", "functional"), { ...review("design-reviewer", "cloudflare", "design"), verdict: "fail" as const }]);
    assert.equal(dissent.status, "quarantined");
    assert.equal(dissent.lease, null);
    assert.equal(dissent.commitDigest, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owner-authorized dissent repair preserves rejected evidence and reruns every delivery gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-review-repair-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const firstClaim = await service.claim(projectId, "worker-a", [candidate]);
    const firstLease = firstClaim.task!.lease!;
    await service.recordImplementation(projectId, taskId, firstLease.leaseId, "worker-a", evidence);
    await service.recordValidation(projectId, taskId, firstLease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: true, exitCode: 0, evidenceDigest: evidence });
    await service.recordValidation(projectId, taskId, firstLease.leaseId, "worker-a", { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: evidence });
    const dissent = await service.recordReviews(projectId, taskId, firstLease.leaseId, "worker-a", [review("functional-reviewer", "gemini", "functional"), { ...review("design-reviewer", "cloudflare", "design"), verdict: "fail" as const }]);
    const approval = { approvalId: "approval_11111111111111111111", expectedRevision: dissent.revision, rationale: "Repair the independently observed design issue without bypassing any gate." };
    const repaired = await service.authorizeReviewRepair(projectId, taskId, approval);
    assert.equal(repaired.status, "queued");
    assert.equal(repaired.reviewAttempts?.[0]?.reviews.some((item) => item.verdict === "fail"), true);
    assert.equal(repaired.reviews.length, 0);
    assert.equal(repaired.implementationEvidence.length, 0);
    assert.equal((await service.authorizeReviewRepair(projectId, taskId, approval)).revision, repaired.revision);

    const restarted = makeService(root, () => 101);
    const secondClaim = await restarted.claim(projectId, "worker-b", [candidate]);
    const secondLease = secondClaim.task!.lease!;
    await restarted.recordImplementation(projectId, taskId, secondLease.leaseId, "worker-b", "f".repeat(64));
    await restarted.recordValidation(projectId, taskId, secondLease.leaseId, "worker-b", { tier: "fast", commandLabel: "typecheck", passed: true, exitCode: 0, evidenceDigest: "f".repeat(64) });
    await restarted.recordValidation(projectId, taskId, secondLease.leaseId, "worker-b", { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: "f".repeat(64) });
    await restarted.recordReviews(projectId, taskId, secondLease.leaseId, "worker-b", [review("functional-reviewer-2", "gemini", "functional"), review("design-reviewer-2", "cloudflare", "design")]);
    const completed = await restarted.recordIntegration(projectId, taskId, secondLease.leaseId, "worker-b", { commitDigest: "1".repeat(40), integrationDigest: "2".repeat(64), validation: { tier: "integration", commandLabel: "post integration", passed: true, exitCode: 0, evidenceDigest: "f".repeat(64) } });
    assert.equal(completed.status, "completed");
    assert.equal(completed.reviewAttempts?.length, 1);
    assert.equal(completed.reviewAttempts?.[0]?.reviews.some((item) => item.verdict === "fail"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owner-authorized provider proposal repair is bounded and archives the failed attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-proposal-repair-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    const interrupted = await service.interrupt(projectId, taskId, lease.leaseId, "worker-a", "Execution needs attention: Provider proposal exceeded grounded file authority.", "implementation");
    const repaired = await service.authorizeReviewRepair(projectId, taskId, {
      approvalId: "approval_33333333333333333333",
      expectedRevision: interrupted.revision,
      rationale: "Retry the bounded provider proposal with exact immutable file authority.",
    });
    assert.equal(repaired.status, "queued");
    assert.equal(repaired.attempt, 1);
    assert.equal(repaired.reviewAttempts?.length, 1);
    assert.deepEqual(repaired.reviewAttempts?.[0]?.reviews, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owner-authorized deterministic validation repair preserves its bounded budget and archives failed proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-validation-repair-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: false, exitCode: 1, evidenceDigest: evidence });
    const interrupted = await service.interrupt(projectId, taskId, lease.leaseId, "worker-a", "Execution needs attention: Healing budget is invalid.", "implementation");
    const repaired = await service.authorizeReviewRepair(projectId, taskId, {
      approvalId: "approval_55555555555555555555",
      expectedRevision: interrupted.revision,
      rationale: "The repaired prerequisite invalidated this deterministic failure; rerun every gate within the remaining bounded budget.",
    });
    assert.equal(repaired.status, "queued");
    assert.equal(repaired.attempt, interrupted.attempt, "owner repair does not replenish the bounded automatic-healing budget");
    assert.equal(repaired.reviewAttempts?.at(-1)?.validations.some((validation) => !validation.passed), true);
    assert.equal(repaired.validations.length, 0);
    assert.equal(repaired.implementationEvidence.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy workspace lifecycle interruption can resume without erasing preserved implementation", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-legacy-workspace-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate], 60_000);
    const task = claimed.task!;
    await service.interrupt(projectId, task.id, task.lease!.leaseId, "worker-a", "Execution needs attention: ENOENT: no such file or directory, open '/tmp/project-task-worktrees/task/package.json'", "product_decision");
    const interrupted = (await service.get(projectId))!.tasks[0]!;
    const resumed = await service.authorizeEnvironmentRetry(projectId, { taskId: interrupted.id, expectedRevision: interrupted.revision, rationale: "Verified lifecycle fix is active." });
    assert.equal(resumed.status, "queued");
    assert.equal(resumed.reviewAttempts?.length ?? 0, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owner can revalidate unchanged delivered files after a legacy post-review commit-authority stop", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-commit-revalidation-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: true, exitCode: 0, evidenceDigest: evidence });
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: evidence });
    await service.recordReviews(projectId, taskId, lease.leaseId, "worker-a", [review("functional-reviewer", "gemini", "functional"), review("design-reviewer", "cloudflare", "design")]);
    const interrupted = await service.interrupt(projectId, taskId, lease.leaseId, "worker-a", "Execution needs attention: Commit changes do not match exact file authority.");
    const repaired = await service.authorizeReviewRepair(projectId, taskId, {
      approvalId: "approval_66666666666666666666",
      expectedRevision: interrupted.revision,
      rationale: "Revalidate the unchanged previously delivered files and rerun every deterministic and independent review gate.",
    });
    assert.equal(repaired.status, "queued");
    assert.equal(repaired.reviewAttempts?.at(-1)?.reviews.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owner-authorized completed prerequisite repair preserves proof and reopens execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-completed-repair-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "initial typecheck", passed: false, exitCode: 1, evidenceDigest: "f".repeat(64) });
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: true, exitCode: 0, evidenceDigest: evidence });
    await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: evidence });
    await service.recordReviews(projectId, taskId, lease.leaseId, "worker-a", [review("functional-reviewer", "gemini", "functional"), review("design-reviewer", "cloudflare", "design")]);
    const completed = await service.recordIntegration(projectId, taskId, lease.leaseId, "worker-a", { commitDigest: "1".repeat(40), integrationDigest: "2".repeat(64), validation: { tier: "integration", commandLabel: "post integration", passed: true, exitCode: 0, evidenceDigest: evidence } });
    const repaired = await service.authorizeCompletedRepair(projectId, taskId, {
      approvalId: "approval_44444444444444444444",
      expectedRevision: completed.revision,
      rationale: "Downstream deterministic evidence invalidated the accepted TypeScript toolchain contract.",
    });
    assert.equal(repaired.status, "queued");
    assert.equal(repaired.commitDigest, null);
    assert.equal(repaired.reviewAttempts?.at(-1)?.reviews.length, 2);
    assert.equal((await service.get(projectId))?.state, "running");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owner-facing work cannot start without build and visual journey validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-ui-acceptance-"));
  try {
    const uiDraft = {
      ...draft,
      items: draft.items.map((item) => item.id === taskId ? {
        ...item,
        title: "Build the owner-facing project page",
        description: "Implement the approved responsive UI and owner journey.",
        validationProfiles: item.validationProfiles,
      } : item),
    };
    const service = new ProjectExecutionService(root, { readDraft: async () => ({ draft: uiDraft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => 100, eligibility);
    await assert.rejects(() => service.initialize(projectId), /lacks build and visual journey validation/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repeated validation failures exhaust the bounded repair budget and quarantine once", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-budget-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    let task = claimed.task!;
    const policy = { maxAttempts: 2, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["typecheck", "test"], requiredReviewRoles: ["functional", "design"], minimumGoldenScore: 90 };
    for (let cycle = 0; cycle < 3; cycle += 1) {
      task = await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
      task = await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: false, exitCode: 1, evidenceDigest: `${cycle}`.repeat(64) });
      task = await service.assessHealing(projectId, taskId, lease.leaseId, "worker-a", { failureClass: "implementation", changedFiles: ["src/app.ts"], policy, goldenScore: 95, previousGoldenScore: 95 });
    }
    assert.equal(task.status, "quarantined");
    assert.equal(task.attempt, 2);
    assert.equal(task.lease, null);
    assert.equal((await service.get(projectId))?.state, "quarantined");
    await assert.rejects(() => service.authorizeQuarantineRecovery(projectId, {
      taskId,
      expectedRevision: task.revision,
      approvalId: "approval_1234567890abcdef1234",
      rationale: "The deterministic validation root cause was repaired and independently verified.",
    }, []), /fresh passing evidence/i);
    const recovered = await service.authorizeQuarantineRecovery(projectId, {
      taskId,
      expectedRevision: task.revision,
      approvalId: "approval_1234567890abcdef1234",
      rationale: "The deterministic validation root cause was repaired and independently verified.",
    }, [
      { profile: "typecheck", passed: true, exitCode: 0, evidenceDigest: evidence },
      { profile: "unit", passed: true, exitCode: 0, evidenceDigest: evidence },
    ]);
    assert.equal(recovered.status, "queued");
    assert.equal(recovered.attempt, 2, "recovery preserves the exhausted repair history");
    assert.equal(recovered.validations.length, 3, "recovery preserves failed validation evidence");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("identical validation evidence stops automatic healing without exhausting the budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-no-progress-"));
  try {
    const service = makeService(root, () => 100);
    await service.initialize(projectId);
    const claimed = await service.claim(projectId, "worker-a", [candidate]);
    const lease = claimed.task!.lease!;
    let task = claimed.task!;
    task = await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    task = await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: false, exitCode: 1, evidenceDigest: evidence });
    task = await service.assessHealing(projectId, taskId, lease.leaseId, "worker-a", { failureClass: "implementation", changedFiles: ["src/app.ts"], policy: { maxAttempts: 10, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["typecheck"], requiredReviewRoles: ["functional", "security"], minimumGoldenScore: 90 }, goldenScore: 95, previousGoldenScore: 95 });
    task = await service.recordImplementation(projectId, taskId, lease.leaseId, "worker-a", evidence);
    task = await service.recordValidation(projectId, taskId, lease.leaseId, "worker-a", { tier: "fast", commandLabel: "typecheck", passed: false, exitCode: 1, evidenceDigest: evidence });
    task = await service.assessHealing(projectId, taskId, lease.leaseId, "worker-a", { failureClass: "implementation", changedFiles: ["src/app.ts"], policy: { maxAttempts: 10, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["typecheck"], requiredReviewRoles: ["functional", "security"], minimumGoldenScore: 90 }, goldenScore: 95, previousGoldenScore: 95 });
    assert.equal(task.status, "needs_user");
    assert.equal(task.attempt, 1);
    assert.match(task.safeMessage, /same validation failure repeated/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function makeService(root: string, now: () => number) {
  return new ProjectExecutionService(root, { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, now, eligibility);
}
function review(reviewerId: string, providerId: string, role: "functional" | "design") { return { reviewerId, providerId, role, verdict: "pass" as const, findings: [{ id: `${role}-finding`, severity: "info" as const, evidenceRef: evidence, confidence: 0.99, acceptanceCriterion: "The approved behavior is implemented and verified.", recommendedRepair: "No repair is required." }] }; }
