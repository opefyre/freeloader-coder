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

test("autonomous worker heals one failure then validates, reviews, integrates, and completes", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-execution-worker-"));
  try {
    const service = new ProjectExecutionService(root, { readDraft: async () => ({ draft, document: { schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: 1, digest, markdown: "# Plan", itemCount: 4 } }) }, { get: async () => ({ completed: true, planDigest: digest, issues: { [taskId]: { issueKey: "PIPE-4" } } }) }, () => 100);
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

function implementation() { return { evidenceDigest: evidence, changedFiles: ["src/app.ts"], goldenScore: 95, previousGoldenScore: 95 }; }
function review(reviewerId: string, providerId: string, role: "functional" | "design") { return { reviewerId, providerId, role, verdict: "pass" as const, findings: [{ id: `${role}-finding`, severity: "info" as const, evidenceRef: evidence, confidence: 0.99, acceptanceCriterion: "The approved behavior is implemented.", recommendedRepair: "No repair is required." }] }; }
