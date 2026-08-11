import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectLifecycleCoordinator } from "../apps/core/src/project-lifecycle-coordinator.js";
import { createProjectLifecycle, advanceProjectLifecycle, type ProjectLifecycleRecord } from "../packages/orchestration/src/project-lifecycle.js";

const projectA = "project_aaaaaaaaaaaaaaaa";
const projectB = "project_bbbbbbbbbbbbbbbb";

test("one per-project lease prevents duplicate workers from dispatching the same stage", async () => {
  const directory = await temporaryDirectory();
  const lifecycle = atSolution(projectA, 10);
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const source = sourceOf([lifecycle]);
  const workers = workerSet(async () => { calls += 1; await blocked; });
  const first = new ProjectLifecycleCoordinator(directory, source, workers, "worker-a", () => 20, 10_000);
  const second = new ProjectLifecycleCoordinator(directory, source, workers, "worker-b", () => 20, 10_000);
  const running = first.reconcile(projectA);
  await waitFor(() => calls === 1);
  assert.equal(await second.reconcile(projectA), "busy");
  release();
  assert.equal(await running, "dispatched");
  assert.equal(calls, 1);
});

test("restart resumes an exact dispatched checkpoint with the same idempotency action", async () => {
  const directory = await temporaryDirectory();
  const lifecycle = atSolution(projectA, 10);
  const actionId = `${projectA}:solution:revision-${lifecycle.revision}`;
  const stateDirectory = join(directory, "project-lifecycle-coordinator");
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, `${projectA}.json`), JSON.stringify({
    schemaVersion: 1, projectId: projectA, revision: 1,
    checkpoint: { stage: lifecycle.stage, lifecycleRevision: lifecycle.revision, at: 9 },
    dispatches: { [actionId]: { actionId, kind: "solution", lifecycleRevision: lifecycle.revision, state: "dispatched", updatedAt: 9 } },
    events: [{ sequence: 1, type: "action_dispatched", stage: lifecycle.stage, actionId, at: 9 }], terminalStage: null,
  }));
  const received: string[] = [];
  const restarted = new ProjectLifecycleCoordinator(directory, sourceOf([lifecycle]), workerSet(async (_projectId, id) => { received.push(id); }), "restarted", () => 20);
  assert.equal(await restarted.reconcile(projectA), "dispatched");
  assert.deepEqual(received, [actionId]);
  assert.equal((await restarted.get(projectA)).dispatches[actionId]?.state, "completed");
  assert.equal(await restarted.reconcile(projectA), "checkpointed");
  assert.deepEqual(received, [actionId]);
});

test("stale lease recovery is recorded and does not duplicate a completed side effect", async () => {
  const directory = await temporaryDirectory();
  const lifecycle = atSolution(projectA, 10);
  const actionId = `${projectA}:solution:revision-${lifecycle.revision}`;
  const coordinator = new ProjectLifecycleCoordinator(directory, sourceOf([lifecycle]), workerSet(async () => { throw new Error("must not run"); }), "recovery", () => 100, 10);
  await coordinator.reconcile(projectA).catch(() => undefined);
  const statePath = join(directory, "project-lifecycle-coordinator", `${projectA}.json`);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.dispatches[actionId].state = "completed";
  await writeFile(statePath, JSON.stringify(state));
  const lock = join(directory, "project-lifecycle-leases", `${projectA}.lock`);
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "owner.json"), JSON.stringify({ token: "00000000-0000-4000-8000-000000000000", ownerId: "crashed", acquiredAt: 0, expiresAt: 1 }));
  await writeFile(join(lock, "heartbeat-00000000-0000-4000-8000-000000000000.json"), JSON.stringify({ at: 1 }));
  assert.equal(await coordinator.reconcile(projectA), "checkpointed");
  assert.ok((await coordinator.get(projectA)).events.some((event) => event.type === "lease_recovered"));
});

test("terminal checkpoints are immutable when underlying state changes without reopen", async () => {
  const directory = await temporaryDirectory();
  let current: ProjectLifecycleRecord = { ...atSolution(projectA, 10), stage: "complete" as const };
  const source = { get: async () => current, list: async () => [current] };
  const coordinator = new ProjectLifecycleCoordinator(directory, source, workerSet(async () => undefined), "terminal", () => 20);
  assert.equal(await coordinator.reconcile(projectA), "terminal");
  current = atSolution(projectA, 30);
  await assert.rejects(() => coordinator.reconcile(projectA), /explicit reopen/);
  current = { ...current, stage: "context_review", revision: current.revision + 1 };
  await coordinator.acknowledgeReopen(projectA, "complete", current.revision);
  assert.equal(await coordinator.reconcile(projectA), "checkpointed");
  assert.equal((await coordinator.get(projectA)).terminalStage, null);
});

test("a crash after an idempotent side effect replays the same action without duplicating the effect", async () => {
  const directory = await temporaryDirectory();
  const lifecycle = atSolution(projectA, 10);
  const effects = new Set<string>();
  let calls = 0;
  const coordinator = new ProjectLifecycleCoordinator(directory, sourceOf([lifecycle]), workerSet(async (_projectId, actionId) => {
    calls += 1;
    effects.add(actionId);
    if (calls === 1) throw new Error("simulated process crash after side effect");
  }), "crash-boundary", () => 20);
  await assert.rejects(() => coordinator.reconcile(projectA), /simulated process crash/);
  assert.equal(await coordinator.reconcile(projectA), "dispatched");
  assert.equal(calls, 2);
  assert.equal(effects.size, 1);
});

test("different projects reconcile concurrently without sharing a lease", async () => {
  const directory = await temporaryDirectory();
  const active = new Set<string>();
  let simultaneous = false;
  const workers = workerSet(async (projectId) => {
    active.add(projectId); simultaneous ||= active.size === 2;
    await new Promise((resolve) => setTimeout(resolve, 15));
    active.delete(projectId);
  });
  const coordinator = new ProjectLifecycleCoordinator(directory, sourceOf([atSolution(projectA, 10), atSolution(projectB, 10)]), workers, "parallel", () => 20);
  assert.equal(await coordinator.reconcileAll(), 2);
  assert.equal(simultaneous, true);
});

function atSolution(projectId: string, now: number): ProjectLifecycleRecord {
  let lifecycle = createProjectLifecycle({ projectId, mission: "Build a complete product", now });
  lifecycle = advanceProjectLifecycle(lifecycle, { type: "begin_context_review" }, now + 1);
  lifecycle = advanceProjectLifecycle(lifecycle, { type: "scope_assessed", assessment: { classification: "new_product", rationale: ["Major product"], affectedDomains: ["product"], estimatedDeveloperHours: 80, requiresArchitectureDecision: true, confidence: 1 } }, now + 2);
  return lifecycle;
}

function sourceOf(records: ProjectLifecycleRecord[]) { return { get: async (projectId: string) => records.find((record) => record.projectId === projectId) ?? null, list: async () => records }; }
function workerSet(solution: (projectId: string, actionId: string) => Promise<unknown>) { return { solution, deliveryPlan: solution, execution: solution }; }
async function waitFor(predicate: () => boolean) { for (let index = 0; index < 100 && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 2)); assert.equal(predicate(), true); }
async function temporaryDirectory() { return mkdtemp(join(tmpdir(), "codkesh-lifecycle-coordinator-")); }
