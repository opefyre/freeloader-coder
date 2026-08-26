import assert from "node:assert/strict";
import test from "node:test";
import { eligibleExecutionTasks, projectExecutionRecordSchema, selectExecutionAssignment, summarizeExecutionRecovery, type ExecutionTask } from "../packages/orchestration/src/project-execution.js";

const baseTask: ExecutionTask = { id: "plan_1111111111111111", jiraIssueKey: "PIPE-1", title: "Implement bounded capability", dependsOn: [], allowedFiles: ["src/feature.ts", "tests/feature.test.ts"], validationProfiles: ["typecheck", "unit"], uiChanged: true, requiredCapabilities: ["coding", "vision"], privacyClass: "source_code", status: "queued", revision: 0, attempt: 0, assignment: null, lease: null, implementationEvidence: [], validations: [], reviews: [], commitDigest: null, integrationDigest: null, failureClass: null, safeMessage: "Queued for an eligible worker.", updatedAt: 1 };
const candidate = { providerId: "groq", modelId: "model", deviceId: "spare-mac", capabilities: ["coding", "vision"], privacyClasses: ["source_code" as const], quotaAvailable: true, billingEnabled: false, activeRequests: 0, safeConcurrency: 1, availableMemoryMb: 8_000, requiredMemoryMb: 4_000, deviceLoad: 0.2, preference: 10 };

test("assignment gates capability, privacy, free quota, concurrency, memory, and device load", () => {
  assert.equal(selectExecutionAssignment({ task: baseTask, candidates: [candidate], now: 10 })?.deviceId, "spare-mac");
  for (const denied of [{ ...candidate, billingEnabled: true }, { ...candidate, quotaAvailable: false }, { ...candidate, activeRequests: 1 }, { ...candidate, availableMemoryMb: 1_000 }, { ...candidate, deviceLoad: 0.95 }, { ...candidate, capabilities: ["coding"] }, { ...candidate, privacyClasses: ["public" as const] }]) assert.equal(selectExecutionAssignment({ task: baseTask, candidates: [denied], now: 10 }), null);
});

test("assignment audit names the exact free route and conflicting files serialize", () => {
  const assignment = selectExecutionAssignment({ task: baseTask, candidates: [candidate], now: 10 });
  assert.match(assignment?.reasons.join(" ") ?? "", /groq\/model/);
  assert.match(assignment?.reasons.join(" ") ?? "", /paid routing is disabled/i);
  const active = { ...baseTask, id: "plan_2222222222222222", status: "running" as const, assignment, lease: { leaseId: "execlease_11111111111111111111", ownerId: "worker-a", acquiredAt: 1, heartbeatAt: 1, expiresAt: 100 } };
  const conflict = { ...baseTask, id: "plan_3333333333333333", allowedFiles: ["src/feature.ts"] };
  const independent = { ...baseTask, id: "plan_4444444444444444", allowedFiles: ["src/other.ts"] };
  const record = projectExecutionRecordSchema.parse({ schemaVersion: 1, projectId: "project_0123456789abcdef", planDigest: "a".repeat(64), state: "running", revision: 1, tasks: [active, conflict, independent], updatedAt: 1 });
  assert.deepEqual(eligibleExecutionTasks(record, 10).map((task) => task.id), [independent.id]);
  assert.deepEqual(eligibleExecutionTasks(record, 101).map((task) => task.id), [conflict.id, independent.id]);
});

test("dependency readiness and completion evidence fail closed", () => {
  const dependency = { ...baseTask, id: "plan_2222222222222222", jiraIssueKey: "PIPE-2" };
  const dependent = { ...baseTask, id: "plan_3333333333333333", jiraIssueKey: "PIPE-3", dependsOn: [dependency.id] };
  const record = projectExecutionRecordSchema.parse({ schemaVersion: 1, projectId: "project_abcdef0123456789", planDigest: "d".repeat(64), state: "running", revision: 0, tasks: [dependency, dependent], updatedAt: 1 });
  assert.deepEqual(eligibleExecutionTasks(record, 1).map((task) => task.id), [dependency.id]);
  assert.throws(() => projectExecutionRecordSchema.parse({ ...record, tasks: [{ ...dependency, status: "completed" }] }), /deterministic validation/);
});

test("owner recovery summary distinguishes automatic retry from owner-gated ambiguity", () => {
  const queued = projectExecutionRecordSchema.parse({ schemaVersion: 1, projectId: "project_abcdef0123456789", planDigest: "d".repeat(64), state: "running", revision: 0, tasks: [baseTask], updatedAt: 1 });
  assert.equal(summarizeExecutionRecovery(queued).state, "queued");
  const retrying = projectExecutionRecordSchema.parse({ schemaVersion: 1, projectId: "project_abcdef0123456789", planDigest: "d".repeat(64), state: "running", revision: 1, tasks: [{ ...baseTask, failureClass: "provider", safeMessage: "The task will resume on a free provider." }], updatedAt: 2 });
  assert.deepEqual(summarizeExecutionRecovery(retrying), {
    state: "recovering", completedTasks: 0, totalTasks: 1, activeJiraIssueKey: "PIPE-1", evidenceDigest: null,
    nextAction: "No action needed; Codkesh will retry on a verified free route.",
  });
  const blocked = projectExecutionRecordSchema.parse({ ...retrying, state: "needs_user", tasks: [{ ...baseTask, status: "needs_user", safeMessage: "Preserved evidence requires owner review." }] });
  assert.equal(summarizeExecutionRecovery(blocked).state, "needs_user");
  assert.equal(summarizeExecutionRecovery(blocked).nextAction, "Review PIPE-1 before execution continues.");

  const completedTask = {
    ...baseTask,
    status: "completed" as const,
    assignment: { providerId: "groq", modelId: "model", deviceId: "provider:one", selectedAt: 1, reasons: ["Eligible free route."] },
    implementationEvidence: ["1".repeat(64)],
    validations: [
      { tier: "fast" as const, commandLabel: "fast", passed: true, exitCode: 0, evidenceDigest: "2".repeat(64), observedAt: 2 },
      { tier: "full" as const, commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: "3".repeat(64), observedAt: 3 },
      { tier: "integration" as const, commandLabel: "integration", passed: true, exitCode: 0, evidenceDigest: "4".repeat(64), observedAt: 4 },
    ],
    reviews: [
      { reviewerId: "reviewer-functional", providerId: "gemini", role: "functional" as const, verdict: "pass" as const, evidenceDigest: "5".repeat(64), findings: [], observedAt: 5 },
      { reviewerId: "reviewer-design", providerId: "cloudflare", role: "design" as const, verdict: "pass" as const, evidenceDigest: "6".repeat(64), findings: [], observedAt: 6 },
    ],
    commitDigest: "7".repeat(40),
    integrationDigest: "8".repeat(64),
    liveJourneyEvidence: { journeyId: "owner-preview", revisionDigest: "7".repeat(40), reference: "local-preview-proof", runtime: "browser" as const, viewport: "1440x900", passed: true, assertions: [{ name: "Owner preview rendered", passed: true, evidenceDigest: "9".repeat(64) }], observedAt: 7 },
    safeMessage: "All gates passed.",
  };
  const completed = projectExecutionRecordSchema.parse({ ...queued, state: "completed", tasks: [completedTask] });
  assert.equal(summarizeExecutionRecovery(completed).state, "completed");
  assert.equal(summarizeExecutionRecovery(completed).evidenceDigest, "8".repeat(64));
});
