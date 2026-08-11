import assert from "node:assert/strict";
import test from "node:test";
import { eligibleExecutionTasks, projectExecutionRecordSchema, selectExecutionAssignment, type ExecutionTask } from "../packages/orchestration/src/project-execution.js";

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
