import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectExecutionCoordinator } from "../apps/core/src/project-execution-coordinator.js";
import { FreeProviderExecutionError } from "../apps/core/src/free-provider-execution-model.js";
import type { ProjectExecutionRecord } from "../packages/orchestration/src/project-execution.js";

const projectId = "project_abcdef0123456789";

test("coordinator serializes a project and persists completion across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-"));
  try {
    let concurrent = 0; let maximum = 0; let calls = 0; let completions = 0;
    const record = executionRecord("completed");
    const service = { get: async () => record, reconcileExpired: async () => undefined };
    const worker = { tick: async () => { calls += 1; concurrent += 1; maximum = Math.max(maximum, concurrent); await delay(20); concurrent -= 1; return record; } };
    const coordinator = new ProjectExecutionCoordinator(root, service, worker, Date.now, 25, async (completedProjectId) => { assert.equal(completedProjectId, projectId); completions += 1; });
    await Promise.all([coordinator.schedule(projectId), coordinator.schedule(projectId), coordinator.schedule(projectId)]);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 1); assert.equal(maximum, 1); assert.equal(completions, 1); await coordinator.shutdown();
    const restarted = new ProjectExecutionCoordinator(root, service, worker, Date.now, 25);
    await restarted.resumePending(); await delay(30); assert.equal(calls, 1); await restarted.shutdown();
    assert.equal(JSON.parse(await readFile(join(root, "project-execution-runs.json"), "utf8")).runs[projectId].state, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("coordinator durably defers temporary free-provider denial", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-"));
  try {
    const retryAt = Date.now() + 60_000;
    const service = { get: async () => executionRecord("running"), reconcileExpired: async () => undefined };
    const worker = { tick: async () => { throw new FreeProviderExecutionError("capacity_unavailable", retryAt, "free quota window"); } };
    const coordinator = new ProjectExecutionCoordinator(root, service, worker);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "deferred");
    const run = await coordinator.get(projectId); assert.equal(run?.retryAt, retryAt); assert.match(run?.safeMessage ?? "", /Free-provider capacity/); await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("coordinator quickly fails over after a provider failure while capacity denials remain deferred", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-failover-"));
  try {
    let now = 10_000;
    const service = { get: async () => executionRecord("running"), reconcileExpired: async () => undefined };
    const worker = { tick: async () => { throw new FreeProviderExecutionError("provider_failed", now + 60_000, "provider rejected this contract"); } };
    const coordinator = new ProjectExecutionCoordinator(root, service, worker, () => now, 300_000);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "deferred");
    const run = await coordinator.get(projectId);
    assert.equal(run?.retryAt, 11_000);
    assert.match(run?.safeMessage ?? "", /another verified free route/);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("offline worker defers without a busy loop and resumes after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-offline-"));
  try {
    let now = 1_000; let calls = 0;
    const record = executionRecord("running");
    const service = { get: async () => record, reconcileExpired: async () => undefined };
    const worker = { tick: async () => { calls += 1; return record; } };
    const first = new ProjectExecutionCoordinator(root, service, worker, () => now, 60_000);
    await first.schedule(projectId); await waitFor(async () => (await first.get(projectId))?.state === "deferred");
    const deferred = await first.get(projectId); assert.equal(deferred?.retryAt, 61_000); assert.match(deferred?.safeMessage ?? "", /No eligible free provider or worker/); assert.equal(calls, 1); await first.shutdown();
    now = 61_000;
    const restarted = new ProjectExecutionCoordinator(root, service, { tick: async () => { calls += 1; return executionRecord("completed"); } }, () => now, 60_000);
    await restarted.resumePending(); await waitFor(async () => (await restarted.get(projectId))?.state === "completed"); assert.equal(calls, 2); await restarted.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restart reconciles stale scheduler attention against verified claimable execution work", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-reconcile-"));
  try {
    const running = executionRecord("running");
    const service = { get: async () => running, reconcileExpired: async () => undefined };
    const failed = new ProjectExecutionCoordinator(root, service, { tick: async () => { throw new Error("post-completion observer race"); } }, Date.now, 60_000);
    await failed.schedule(projectId);
    await waitFor(async () => (await failed.get(projectId))?.state === "needs_user");
    await failed.shutdown();

    let calls = 0;
    const restarted = new ProjectExecutionCoordinator(root, service, { tick: async () => { calls += 1; return executionRecord("completed"); } }, Date.now, 60_000);
    await restarted.resumePending();
    await waitFor(async () => (await restarted.get(projectId))?.state === "completed");
    assert.equal(calls, 1);
    await restarted.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restart reconciles a stale scheduler stop after canonical execution already completed", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-completed-reconcile-"));
  try {
    const completed = executionRecord("completed");
    const service = { get: async () => completed, reconcileExpired: async () => undefined };
    const failed = new ProjectExecutionCoordinator(root, service, { tick: async () => { throw new Error("completion observer failed"); } }, Date.now, 60_000);
    await failed.schedule(projectId);
    await waitFor(async () => (await failed.get(projectId))?.state === "needs_user");
    await failed.shutdown();

    let completions = 0;
    let workerCalls = 0;
    const restarted = new ProjectExecutionCoordinator(root, service, { tick: async () => { workerCalls += 1; return completed; } }, Date.now, 60_000, async () => { completions += 1; });
    await restarted.resumePending();
    assert.equal((await restarted.get(projectId))?.state, "completed");
    assert.equal(completions, 1);
    assert.equal(workerCalls, 0);
    await restarted.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("coordinator re-arms the next attempt after releasing the in-flight project lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-rearm-"));
  try {
    let calls = 0;
    const running = executionRecord("running");
    const service = { get: async () => running, reconcileExpired: async () => undefined };
    const worker = { tick: async () => { calls += 1; return calls === 1 ? running : executionRecord("completed"); } };
    const coordinator = new ProjectExecutionCoordinator(root, service, worker, Date.now, 20);

    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");

    assert.equal(calls, 2);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("oldest deferred projects dispatch fairly under the concurrency limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-fair-"));
  try {
    const second = "project_1111111111111111"; const order: string[] = []; let active = 0; let maximum = 0;
    const service = { get: async (id: string) => executionRecordFor(id, "running"), reconcileExpired: async () => undefined };
    const worker = { tick: async (id: string) => { order.push(id); active += 1; maximum = Math.max(maximum, active); await delay(10); active -= 1; return executionRecordFor(id, "completed"); } };
    const coordinator = new ProjectExecutionCoordinator(root, service, worker, Date.now, 60_000, async () => undefined, 1);
    await coordinator.schedule(projectId); await coordinator.schedule(second);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed" && (await coordinator.get(second))?.state === "completed");
    assert.deepEqual(order, [projectId, second]); assert.equal(maximum, 1); await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("time-controlled 12-hour soak survives hourly restarts without spins or duplicate completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "execution-coordinator-soak-"));
  try {
    let now = 0; let calls = 0; let completions = 0;
    const running = executionRecord("running");
    const service = { get: async () => running, reconcileExpired: async () => undefined };
    const worker = { tick: async () => { calls += 1; return calls === 12 ? executionRecord("completed") : running; } };
    let coordinator = new ProjectExecutionCoordinator(root, service, worker, () => now, 60 * 60_000, async () => { completions += 1; });
    await coordinator.schedule(projectId);
    for (let hour = 0; hour < 12; hour += 1) {
      const priorAttempts = (await coordinator.get(projectId))?.attempts ?? 0;
      if (hour > 0) { await coordinator.shutdown(); now = hour * 60 * 60_000; coordinator = new ProjectExecutionCoordinator(root, service, worker, () => now, 60 * 60_000, async () => { completions += 1; }); await coordinator.resumePending(); }
      await waitFor(async () => ((await coordinator.get(projectId))?.attempts ?? 0) > priorAttempts);
    }
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 12); assert.equal(completions, 1); await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

function executionRecord(state: "running" | "completed"): ProjectExecutionRecord { return { schemaVersion: 1, projectId, planDigest: "d".repeat(64), state, revision: 0, tasks: [{ id: "plan_0000000000000001", jiraIssueKey: "PIPE-1", title: "Bounded task", dependsOn: [], allowedFiles: ["src/app.ts"], validationProfiles: ["typecheck"], uiChanged: false, requiredCapabilities: ["chat"], privacyClass: "source_code", status: state === "completed" ? "completed" : "queued", revision: 0, attempt: 0, assignment: state === "completed" ? { providerId: "groq", modelId: "model", deviceId: "provider:one", selectedAt: 1, reasons: ["Eligible provider."] } : null, lease: null, implementationEvidence: state === "completed" ? ["a".repeat(64)] : [], validations: state === "completed" ? [{ tier: "fast", commandLabel: "fast", passed: true, exitCode: 0, evidenceDigest: "b".repeat(64), observedAt: 1 }, { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: "c".repeat(64), observedAt: 1 }, { tier: "integration", commandLabel: "integration", passed: true, exitCode: 0, evidenceDigest: "d".repeat(64), observedAt: 1 }] : [], reviews: state === "completed" ? [{ reviewerId: "reviewer-one", providerId: "gemini", role: "functional", verdict: "pass", evidenceDigest: "e".repeat(64), findings: [], observedAt: 1 }, { reviewerId: "reviewer-two", providerId: "cloudflare", role: "security", verdict: "pass", evidenceDigest: "f".repeat(64), findings: [], observedAt: 1 }] : [], commitDigest: state === "completed" ? "1".repeat(40) : null, integrationDigest: state === "completed" ? "2".repeat(64) : null, failureClass: null, safeMessage: "State", updatedAt: 1 }], updatedAt: 1 }; }
function executionRecordFor(id: string, state: "running" | "completed") { return { ...executionRecord(state), projectId: id, tasks: executionRecord(state).tasks.map((task) => ({ ...task })) } as ProjectExecutionRecord; }
async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (true) {
    if (await predicate()) return;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for coordinator state.");
    await delay(10);
  }
}
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
