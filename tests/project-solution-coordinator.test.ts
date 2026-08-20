import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectSolutionCoordinator } from "../apps/core/src/project-solution-coordinator.js";
import { FreeProviderSolutionUnavailableError } from "../apps/core/src/free-provider-solution-model.js";
import { ProjectEgressDeniedError } from "../apps/core/src/project-egress-policy-service.js";

const projectId = "project_abcdef0123456789";

test("solution coordinator returns immediately, persists completion, and does not duplicate work", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-coordinator-"));
  try {
    let calls = 0;
    const coordinator = new ProjectSolutionCoordinator(root, { run: async () => { calls += 1; return {} as any; } } as any, () => 100);
    const queued = await coordinator.schedule(projectId);
    assert.equal(queued.state, "queued");
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 1);
    assert.equal((await coordinator.schedule(projectId)).state, "completed");
    assert.equal(calls, 1);
    const restarted = new ProjectSolutionCoordinator(root, { run: async () => { calls += 1; return {} as any; } } as any, () => 200);
    assert.equal((await restarted.get(projectId))?.state, "completed");
    assert.equal(await restarted.resumePending(), 0);
    await coordinator.shutdown(); await restarted.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution coordinator projects owner-safe consent failures without retry loops", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-coordinator-denied-"));
  try {
    const coordinator = new ProjectSolutionCoordinator(root, { run: async () => { throw new ProjectEgressDeniedError("Approve this project first."); } } as any, () => 100);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "needs_user");
    const run = await coordinator.get(projectId);
    assert.equal(run?.attempts, 1);
    assert.equal(run?.safeMessage, "Approve this project first.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await coordinator.get(projectId))?.attempts, 1);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution coordinator explains safe preparation failures without leaking unknown errors", async () => {
  const contextRoot = await mkdtemp(join(tmpdir(), "solution-coordinator-context-failure-"));
  const unknownRoot = await mkdtemp(join(tmpdir(), "solution-coordinator-unknown-failure-"));
  try {
    const contextFailure = new ProjectSolutionCoordinator(contextRoot, { run: async () => { throw new Error("Project context contains sensitive or personal material and must remain local."); } } as any, () => 100);
    await contextFailure.schedule(projectId);
    await waitFor(async () => (await contextFailure.get(projectId))?.state === "needs_user");
    assert.equal((await contextFailure.get(projectId))?.safeMessage, "Project context contains sensitive or personal material and must remain local.");

    const unknownFailure = new ProjectSolutionCoordinator(unknownRoot, { run: async () => { throw new Error("credential=do-not-leak"); } } as any, () => 100);
    await unknownFailure.schedule(projectId);
    await waitFor(async () => (await unknownFailure.get(projectId))?.state === "needs_user");
    assert.equal((await unknownFailure.get(projectId))?.safeMessage, "Solution research stopped safely. Review provider and project evidence before retrying.");
    await contextFailure.shutdown(); await unknownFailure.shutdown();
  } finally { await rm(contextRoot, { recursive: true, force: true }); await rm(unknownRoot, { recursive: true, force: true }); }
});

test("solution coordinator defers a free-provider outage and recovers without duplicate work", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-coordinator-provider-recovery-"));
  let now = 100;
  let calls = 0;
  try {
    const coordinator = new ProjectSolutionCoordinator(root, {
      run: async () => {
        calls += 1;
        if (calls === 1) throw new FreeProviderSolutionUnavailableError(150, "Free providers are temporarily unavailable.");
        return {} as any;
      },
    } as any, () => now);

    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "deferred");
    const deferred = await coordinator.get(projectId);
    assert.equal(deferred?.attempts, 1);
    assert.equal(deferred?.retryAt, 150);
    assert.equal(deferred?.safeMessage, "Free providers are temporarily unavailable.");

    assert.equal((await coordinator.schedule(projectId)).state, "deferred");
    assert.equal(calls, 1);

    now = 151;
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal((await coordinator.get(projectId))?.attempts, 2);
    assert.equal(calls, 2);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an explicit start retries deferred work immediately after provider eligibility changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-coordinator-provider-change-"));
  let calls = 0;
  try {
    const coordinator = new ProjectSolutionCoordinator(root, {
      run: async () => {
        calls += 1;
        if (calls === 1) throw new FreeProviderSolutionUnavailableError(3_600_100, "The selected provider is rate limited.");
        return {} as any;
      },
    } as any, () => 100);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "deferred");
    assert.equal(calls, 1);
    const queued = await coordinator.schedule(projectId, { forceDeferredRetry: true });
    assert.equal(queued.state, "queued");
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 2);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution coordinator never hot-loops when a provider returns a retry time in the past", async () => {
  const root = await mkdtemp(join(tmpdir(), "solution-coordinator-past-retry-"));
  let calls = 0;
  try {
    const coordinator = new ProjectSolutionCoordinator(root, { run: async () => { calls += 1; throw new FreeProviderSolutionUnavailableError(50, "Provider evidence is stale."); } } as any, () => 100);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "deferred");
    const run = await coordinator.get(projectId);
    assert.equal(run?.retryAt, 60_100);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, 1);
    assert.equal((await coordinator.get(projectId))?.attempts, 1);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function waitFor(predicate: () => Promise<boolean>) { for (let index = 0; index < 100; index += 1) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 2)); } throw new Error("Timed out waiting for coordinator state."); }
