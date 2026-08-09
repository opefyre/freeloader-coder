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
    let concurrent = 0; let maximum = 0; let calls = 0;
    const record = executionRecord("completed");
    const service = { get: async () => record, reconcileExpired: async () => undefined };
    const worker = { tick: async () => { calls += 1; concurrent += 1; maximum = Math.max(maximum, concurrent); await delay(20); concurrent -= 1; return record; } };
    const coordinator = new ProjectExecutionCoordinator(root, service, worker, Date.now, 25);
    await Promise.all([coordinator.schedule(projectId), coordinator.schedule(projectId), coordinator.schedule(projectId)]);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 1); assert.equal(maximum, 1); coordinator.stop();
    const restarted = new ProjectExecutionCoordinator(root, service, worker, Date.now, 25);
    await restarted.resumePending(); await delay(30); assert.equal(calls, 1); restarted.stop();
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
    const run = await coordinator.get(projectId); assert.equal(run?.retryAt, retryAt); assert.match(run?.safeMessage ?? "", /Free-provider capacity/); coordinator.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

function executionRecord(state: "running" | "completed"): ProjectExecutionRecord { return { schemaVersion: 1, projectId, planDigest: "d".repeat(64), state, revision: 0, tasks: [{ id: "plan_0000000000000001", jiraIssueKey: "PIPE-1", title: "Bounded task", dependsOn: [], allowedFiles: ["src/app.ts"], validationProfiles: ["typecheck"], uiChanged: false, requiredCapabilities: ["chat"], privacyClass: "source_code", status: state === "completed" ? "completed" : "queued", revision: 0, attempt: 0, assignment: state === "completed" ? { providerId: "groq", modelId: "model", deviceId: "provider:one", selectedAt: 1, reasons: ["Eligible provider."] } : null, lease: null, implementationEvidence: state === "completed" ? ["a".repeat(64)] : [], validations: state === "completed" ? [{ tier: "fast", commandLabel: "fast", passed: true, exitCode: 0, evidenceDigest: "b".repeat(64), observedAt: 1 }, { tier: "full", commandLabel: "full", passed: true, exitCode: 0, evidenceDigest: "c".repeat(64), observedAt: 1 }, { tier: "integration", commandLabel: "integration", passed: true, exitCode: 0, evidenceDigest: "d".repeat(64), observedAt: 1 }] : [], reviews: state === "completed" ? [{ reviewerId: "reviewer-one", providerId: "gemini", role: "functional", verdict: "pass", evidenceDigest: "e".repeat(64), findings: [], observedAt: 1 }, { reviewerId: "reviewer-two", providerId: "cloudflare", role: "security", verdict: "pass", evidenceDigest: "f".repeat(64), findings: [], observedAt: 1 }] : [], commitDigest: state === "completed" ? "1".repeat(40) : null, integrationDigest: state === "completed" ? "2".repeat(64) : null, failureClass: null, safeMessage: "State", updatedAt: 1 }], updatedAt: 1 }; }
async function waitFor(predicate: () => Promise<boolean>) { for (let index = 0; index < 100; index += 1) { if (await predicate()) return; await delay(10); } throw new Error("Timed out waiting for coordinator state."); }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
