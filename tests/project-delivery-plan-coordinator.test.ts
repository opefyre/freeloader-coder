import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProjectDeliveryPlanCoordinator } from "../apps/core/src/project-delivery-plan-coordinator.js";
import { FreeProviderSolutionUnavailableError } from "../apps/core/src/free-provider-solution-model.js";
import { ProjectEgressDeniedError } from "../apps/core/src/project-egress-policy-service.js";

const projectId = "project_abcdef0123456789";

test("delivery plan coordinator persists completion and never duplicates completed work", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-plan-coordinator-"));
  try {
    let calls = 0;
    const coordinator = new ProjectDeliveryPlanCoordinator(root, {
      run: async () => { calls += 1; return {} as never; },
    } as never, () => 100);
    assert.equal((await coordinator.schedule(projectId)).state, "queued");
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 1);
    assert.equal((await coordinator.schedule(projectId)).state, "completed");
    assert.equal(calls, 1);
    const restarted = new ProjectDeliveryPlanCoordinator(root, {
      run: async () => { calls += 1; return {} as never; },
    } as never, () => 200);
    assert.equal((await restarted.get(projectId))?.state, "completed");
    assert.equal(await restarted.resumePending(), 0);
    await coordinator.shutdown(); await restarted.shutdown();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delivery plan coordinator exposes safe owner action without retry loops", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-plan-coordinator-denied-"));
  try {
    const coordinator = new ProjectDeliveryPlanCoordinator(root, {
      run: async () => { throw new ProjectEgressDeniedError("Approve this project first."); },
    } as never, () => 100);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "needs_user");
    const run = await coordinator.get(projectId);
    assert.equal(run?.attempts, 1);
    assert.equal(run?.safeMessage, "Approve this project first.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await coordinator.get(projectId))?.attempts, 1);
    await coordinator.shutdown();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delivery plan completion includes the resumable Jira synchronization gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-plan-coordinator-jira-"));
  try {
    const calls: string[] = [];
    const coordinator = new ProjectDeliveryPlanCoordinator(root, {
      run: async () => { calls.push("plan"); return {} as never; },
    } as never, () => 100, async () => { calls.push("jira"); });
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.deepEqual(calls, ["plan", "jira"]);
    assert.match((await coordinator.get(projectId))?.safeMessage ?? "", /Jira hierarchy/);
    await coordinator.shutdown();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delivery plan coordinator defers provider capacity and resumes without duplicate planning", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-plan-coordinator-provider-"));
  let now = 100;
  let calls = 0;
  try {
    const coordinator = new ProjectDeliveryPlanCoordinator(root, { run: async () => { calls += 1; if (calls === 1) throw new FreeProviderSolutionUnavailableError(150, "Free planning capacity is temporarily unavailable."); return {} as never; } } as never, () => now);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "deferred");
    assert.equal(calls, 1);
    assert.equal((await coordinator.get(projectId))?.retryAt, 150);
    assert.equal((await coordinator.schedule(projectId)).state, "deferred");
    assert.equal(calls, 1);
    now = 151;
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 2);
    assert.equal((await coordinator.get(projectId))?.attempts, 2);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an explicit backlog retry clears a preserved provider deferral", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-plan-force-retry-"));
  try {
    let calls = 0;
    const coordinator = new ProjectDeliveryPlanCoordinator(root, { run: async () => { calls += 1; if (calls === 1) throw new FreeProviderSolutionUnavailableError(10_000, "Free planning capacity is temporarily unavailable."); return {} as never; } } as never, () => 100);
    await coordinator.schedule(projectId);
    await waitFor(async () => (await coordinator.get(projectId))?.state === "deferred");
    const queued = await coordinator.schedule(projectId, { forceDeferredRetry: true });
    assert.equal(queued.state, "queued");
    await waitFor(async () => (await coordinator.get(projectId))?.state === "completed");
    assert.equal(calls, 2);
    await coordinator.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function waitFor(predicate: () => Promise<boolean>) {
  for (let index = 0; index < 100; index += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for delivery plan coordinator state.");
}
