import assert from "node:assert/strict";
import test from "node:test";

import { ProjectExecutionRuntimeAdapters } from "../apps/core/src/project-execution-runtime-adapters.js";
import type { ExecutionCandidate, ExecutionTask } from "../packages/orchestration/src/project-execution.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

const projectId = "project_abcdef0123456789";
const digest = "d".repeat(64);
const taskId = "plan_0000000000000004";
const implementer = candidate("groq", "provider:implementation");
const reviewer = candidate("gemini", "provider:review");

test("runtime adapter joins exact provider output, bounded workspace, validation, reviews, integration, and Jira observation", async () => {
  const calls: string[] = [];
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  const model = {
    candidates: async (_permit: unknown, role: string) => role === "implementer" ? [implementer] : [reviewer],
    run: async (input: any) => {
      calls.push(`model:${input.role}:${input.taskId}`);
      if (input.role === "implementer") {
        assert.equal(input.sources.some((source: { name: string }) => source.name === `delivery-plan://${taskId}`), true);
        return { providerId: "groq", modelId: "coder", artifactDigest: "a".repeat(64), response: { summary: "Update feature", operations: [{ type: "replace", path: "src/workflow.ts", content: "export const value = 2;\n", citations: ["src/workflow.ts"], rationale: "Meet the approved behavior." }] } };
      }
      const role = input.taskId.endsWith("security") ? "security" : "functional";
      return { providerId: "gemini", modelId: "reviewer", artifactDigest: "b".repeat(64), response: { reviewerId: `${role}-reviewer`, verdict: "pass", findings: [{ id: `${role}-1`, severity: "info", evidenceRef: digest, confidence: 0.99, acceptanceCriterion: "Approved behavior is present.", recommendedRepair: "No repair is required." }] } };
    },
  };
  const workspaces = {
    prepare: async () => { calls.push("prepare"); return workspace; },
    sources: async () => [{ path: "src/workflow.ts", content: "export const value = 1;\n", digest: "c".repeat(64) }],
    apply: async (_workspace: unknown, _task: unknown, operations: any[]) => { calls.push("apply"); assert.equal(operations[0].expectedBeforeDigest, "c".repeat(64)); return { changedFiles: ["src/workflow.ts"], evidenceDigest: "e".repeat(64) }; },
    validate: async () => [{ profile: "unit", passed: true, exitCode: 0, output: "ok", evidenceDigest: digest }],
    commit: async () => ({ commitDigest: "f".repeat(40), evidenceDigest: digest }),
    integrate: async () => ({ integrationDigest: digest }),
    revertIntegration: async () => { throw new Error("must not revert passing integration"); },
  };
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq", "gemini"], approvedAt: 1, expiresAt: 999_999 };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" }, { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [{ schemaVersion: 1, reviewerId: "delivery-reviewer", discipline: "delivery", verdict: "pass", findings: [] }, { schemaVersion: 1, reviewerId: "technical-reviewer", discipline: "technical", verdict: "pass", findings: [] }] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) }, { authorize: async () => permit }, model, workspaces as any,
    { synchronize: async () => { calls.push("jira"); } }
  );
  const task = executionTask();
  assert.equal((await adapters.candidates(projectId))[0]?.providerId, "groq");
  const implementation = await adapters.implement(projectId, task, 0);
  assert.deepEqual(implementation.changedFiles, ["src/workflow.ts"]);
  assert.equal((await adapters.validate(projectId, task, "fast")).passed, true);
  const reviews = await adapters.review(projectId, { ...task, validations: [{ tier: "fast", commandLabel: "unit", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 1 }, { tier: "full", commandLabel: "unit", passed: true, exitCode: 0, evidenceDigest: digest, observedAt: 1 }] });
  assert.deepEqual(reviews.map((item) => item.role), ["functional", "security"]);
  assert.equal(reviews.every((item) => item.providerId === "gemini"), true);
  assert.equal((await adapters.integrate(projectId, task)).validation.passed, true);
  await adapters.observe(projectId);
  assert.deepEqual(calls, ["prepare", `model:implementer:${taskId}`, "apply", `model:reviewer:${taskId}-functional`, `model:reviewer:${taskId}-security`, "jira"]);
});

test("runtime adapter grounds a first source file in the reviewed delivery task", async () => {
  const workspace = { projectId, taskId, root: "/isolated", branch: "studio/task", baseline: "a".repeat(40), authorityDigest: digest };
  let applied = false;
  const model = {
    candidates: async () => [implementer],
    run: async (input: any) => {
      assert.deepEqual(input.sources.map((source: { name: string }) => source.name), [`delivery-plan://${taskId}`]);
      return { providerId: "groq", modelId: "coder", artifactDigest: "a".repeat(64), response: { summary: "Create first feature", operations: [{ type: "create", path: "src/workflow.ts", content: "export const value = 1;\n", citations: [`delivery-plan://${taskId}`], rationale: "Implement the reviewed task." }] } };
    },
  };
  const permit = { schemaVersion: 1 as const, projectId, contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["groq"], approvedAt: 1, expiresAt: 999_999 };
  const workspaces = {
    prepare: async () => workspace,
    sources: async () => [],
    apply: async (_workspace: unknown, _task: unknown, operations: any[]) => { applied = true; assert.equal(operations[0].expectedBeforeDigest, null); return { changedFiles: ["src/workflow.ts"], evidenceDigest: "e".repeat(64) }; },
  };
  const adapters = new ProjectExecutionRuntimeAdapters(
    { canonicalRoot: async () => "/canonical" },
    { readDraft: async () => ({ draft: { ...completeDeliveryPlan(), revision: 1, reviews: [] } as any }) },
    { readVerified: async () => ({ digest: permit.contextDigest }) },
    { authorize: async () => permit }, model, workspaces as any,
    { synchronize: async () => undefined }
  );
  const result = await adapters.implement(projectId, executionTask(), 0);
  assert.equal(applied, true);
  assert.deepEqual(result.changedFiles, ["src/workflow.ts"]);
});

function candidate(providerId: string, deviceId: string): ExecutionCandidate { return { providerId, modelId: providerId === "groq" ? "coder" : "reviewer", deviceId, capabilities: ["chat", "structured_output"], privacyClasses: ["source_code"], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 1, requiredMemoryMb: 0, deviceLoad: 0, preference: 10 }; }
function executionTask(): ExecutionTask { return { id: taskId, jiraIssueKey: "PIPE-4", title: "Implement workflow contract", dependsOn: [], allowedFiles: ["src/workflow.ts"], validationProfiles: ["unit"], uiChanged: false, requiredCapabilities: ["chat", "structured_output"], privacyClass: "source_code", status: "running", revision: 1, attempt: 0, assignment: { providerId: "groq", modelId: "coder", deviceId: "provider:implementation", selectedAt: 1, reasons: ["All gates passed."] }, lease: { leaseId: "execlease_11111111111111111111", ownerId: "worker", acquiredAt: 1, heartbeatAt: 1, expiresAt: 999_999 }, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Running.", updatedAt: 1 }; }
