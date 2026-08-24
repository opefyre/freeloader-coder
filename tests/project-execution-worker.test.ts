import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectExecutionService } from "../apps/core/src/project-execution-service.js";
import { ProjectExecutionWorker, type ProjectExecutionAdapters } from "../apps/core/src/project-execution-worker.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_abcdef0123456789";
const taskId = "plan_0000000000000004";
const digest = "d".repeat(64);
const evidence = "e".repeat(64);
const plan = completeDeliveryPlan();
const draft = { ...plan, revision: 1, reviews: [{ schemaVersion: 1 as const, reviewerId: "delivery-reviewer", discipline: "delivery" as const, verdict: "pass" as const, findings: [] }, { schemaVersion: 1 as const, reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: [] }] };
const eligibility = { eligibility: async () => ({ schemaVersion: 1 as const, projectId, requestId: "request_0123456789abcdef0123", eligible: true, assessment: { classification: "major_feature" as const, rationale: ["Multi-stage feature."], affectedDomains: ["frontend", "backend"], estimatedDeveloperHours: 24, requiresArchitectureDecision: true, confidence: 1 }, evidence: ["Approved major feature."], alternatives: [], override: null, decidedAt: 1 }) };

test("autonomous worker heals one failure then validates, reviews, integrates, and completes", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-worker-"));
  try {
    const service = new ProjectExecutionService(root, { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => 100, eligibility);
    let fastCalls = 0;
    const sequence: string[] = [];
    const adapters: ProjectExecutionAdapters = {
      candidates: async () => [{ providerId: "groq", modelId: "coder", deviceId: "spare-mac", capabilities: ["chat", "structured_output"], privacyClasses: ["source_code"], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 4_000, deviceLoad: 0.2, preference: 10 }],
      implement: async () => { sequence.push("implement"); return implementation(); },
      validate: async (_project, _task, tier) => { sequence.push(tier); if (tier === "fast") fastCalls += 1; return { tier, commandLabel: tier, passed: tier === "full" || fastCalls > 1, exitCode: tier === "full" || fastCalls > 1 ? 0 : 1, evidenceDigest: evidence }; },
      classifyFailure: async () => "implementation",
      healingPolicy: async () => ({ maxAttempts: 2, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["fast", "full", "integration"], requiredReviewRoles: ["functional", "design"], minimumGoldenScore: 90 }),
      heal: async () => { sequence.push("heal"); return implementation(); },
      review: async () => { sequence.push("review"); return [review("functional-reviewer", "gemini", "functional"), review("design-reviewer", "cloudflare", "design")]; },
      integrate: async () => { sequence.push("integrate"); return { commitDigest: evidence, integrationDigest: evidence, validation: { tier: "integration", commandLabel: "post integration", passed: true, exitCode: 0, evidenceDigest: evidence } }; },
      observe: async () => { sequence.push("observe"); },
    };
    const result = await new ProjectExecutionWorker(service, adapters, "worker-a", 30_000).tick(projectId);
    assert.equal(result?.state, "completed");
    assert.deepEqual(sequence, ["implement", "fast", "heal", "fast", "full", "review", "integrate", "observe"]);
    assert.equal(result?.tasks[0]?.attempt, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("integration conflict pauses safely, preserves non-completion, and publishes the state", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-conflict-"));
  try {
    const service = new ProjectExecutionService(root, { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => 100, eligibility);
    let observed = 0;
    const adapters: ProjectExecutionAdapters = {
      candidates: async () => [{ providerId: "groq", modelId: "coder", deviceId: "spare-mac", capabilities: ["chat", "structured_output"], privacyClasses: ["source_code"], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 4_000, deviceLoad: 0.2, preference: 10 }],
      implement: async () => implementation(), validate: async (_project, _task, tier) => ({ tier, commandLabel: tier, passed: true, exitCode: 0, evidenceDigest: evidence }), classifyFailure: async () => "implementation",
      healingPolicy: async () => ({ maxAttempts: 2, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["fast", "full", "integration"], requiredReviewRoles: ["functional", "design"], minimumGoldenScore: 90 }), heal: async () => implementation(),
      review: async () => [review("functional-reviewer", "gemini", "functional"), review("design-reviewer", "cloudflare", "design")],
      integrate: async () => { throw new Error("integration_conflict: canonical baseline changed"); }, observe: async () => { observed += 1; },
    };
    await assert.rejects(() => new ProjectExecutionWorker(service, adapters, "worker-a", 30_000).tick(projectId), /integration_conflict/);
    const stopped = await service.get(projectId);
    assert.equal(stopped?.state, "needs_user");
    assert.equal(stopped?.tasks[0]?.status, "needs_user");
    assert.equal(stopped?.tasks[0]?.commitDigest, null);
    assert.match(stopped?.tasks[0]?.safeMessage ?? "", /integration_conflict/);
    assert.equal(observed, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("provider proposal contract failure is contained as repairable implementation attention", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-proposal-contract-"));
  try {
    const service = new ProjectExecutionService(root, { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => 100, eligibility);
    const adapters: ProjectExecutionAdapters = {
      candidates: async () => [{ providerId: "groq", modelId: "coder", deviceId: "spare-mac", capabilities: ["chat", "structured_output"], privacyClasses: ["source_code"], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 4_000, deviceLoad: 0.2, preference: 10 }],
      implement: async () => { throw new Error("Provider proposal failed strict response contract: summary Too big: expected string to have <=500 characters"); },
      validate: async (_project, _task, tier) => ({ tier, commandLabel: tier, passed: true, exitCode: 0, evidenceDigest: evidence }),
      classifyFailure: async () => "implementation", healingPolicy: async () => ({ maxAttempts: 2, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["fast"], requiredReviewRoles: ["functional"], minimumGoldenScore: 90 }), heal: async () => implementation(),
      review: async () => [], integrate: async () => ({ commitDigest: evidence, integrationDigest: evidence, validation: { tier: "integration", commandLabel: "integration", passed: true, exitCode: 0, evidenceDigest: evidence } }),
    };
    const result = await new ProjectExecutionWorker(service, adapters, "worker-a", 30_000).tick(projectId);
    assert.equal(result?.state, "needs_user");
    assert.equal(result?.tasks[0]?.status, "needs_user");
    assert.equal(result?.tasks[0]?.failureClass, "implementation");
    assert.match(result?.tasks[0]?.safeMessage ?? "", /failed strict response contract/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("post-completion observer failure preserves completion and does not halt autonomous continuation", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-observer-failure-"));
  try {
    const service = new ProjectExecutionService(root, { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => 100, eligibility);
    const adapters: ProjectExecutionAdapters = {
      candidates: async () => [{ providerId: "groq", modelId: "coder", deviceId: "spare-mac", capabilities: ["chat", "structured_output"], privacyClasses: ["source_code"], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 4_000, deviceLoad: 0.2, preference: 10 }],
      implement: async () => implementation(), validate: async (_project, _task, tier) => ({ tier, commandLabel: tier, passed: true, exitCode: 0, evidenceDigest: evidence }), classifyFailure: async () => "implementation",
      healingPolicy: async () => ({ maxAttempts: 2, allowedFiles: ["src/app.ts"], protectedPaths: ["secrets"], requiredChecks: ["fast", "full", "integration"], requiredReviewRoles: ["functional", "design"], minimumGoldenScore: 90 }), heal: async () => implementation(),
      review: async () => [review("functional-reviewer", "gemini", "functional"), review("design-reviewer", "cloudflare", "design")],
      integrate: async () => ({ commitDigest: evidence, integrationDigest: evidence, validation: { tier: "integration", commandLabel: "post integration", passed: true, exitCode: 0, evidenceDigest: evidence } }),
      observe: async () => { throw new Error("temporary Jira synchronization failure"); },
    };
    const result = await new ProjectExecutionWorker(service, adapters, "worker-a", 30_000).tick(projectId);
    assert.equal(result?.state, "completed");
    assert.equal(result?.tasks[0]?.status, "completed");
    assert.equal(result?.tasks[0]?.commitDigest, evidence);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function implementation() { return { evidenceDigest: evidence, changedFiles: ["src/app.ts"], goldenScore: 95, previousGoldenScore: 95 }; }
function review(reviewerId: string, providerId: string, role: "functional" | "design") { return { reviewerId, providerId, role, verdict: "pass" as const, findings: [{ id: `${role}-finding`, severity: "info" as const, evidenceRef: evidence, confidence: 0.99, acceptanceCriterion: "The approved behavior is implemented.", recommendedRepair: "No repair is required." }] }; }
