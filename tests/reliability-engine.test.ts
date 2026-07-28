import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHealth, errorBudget } from "../packages/reliability/src/health.js";
import { recoveryDecision } from "../packages/reliability/src/supervisor.js";
import { reconcileInterruption } from "../packages/reliability/src/reconciliation.js";
import { planStuckRecovery } from "../packages/reliability/src/stuck.js";
import { releaseGate, type ChaosResult } from "../packages/reliability/src/chaos.js";

test("health follows safe activity, not process existence or elapsed time alone", () => {
  assert.equal(evaluateHealth({ processRunning: true, safeProgressAt: null, activeModelAt: null, activeValidationAt: null, now: 1000, slowAfterMs: 100, stalledAfterMs: 500, dependencyBlocked: false, dataIntegrityValid: true }), "stalled");
  assert.equal(evaluateHealth({ processRunning: true, safeProgressAt: 100, activeModelAt: 950, activeValidationAt: null, now: 1000, slowAfterMs: 100, stalledAfterMs: 500, dependencyBlocked: false, dataIntegrityValid: true }), "healthy");
  assert.equal(errorBudget({ objective: .99, total: 1000, failures: 20 }).releaseAllowed, false);
});

test("supervisor restarts only the exact stopped service after duplicate, request, and lease checks", () => {
  const services = [{ id: "worker", runningProcesses: 0, activeRequest: false, liveLease: false, crashCount: 1, lastCrashAt: 10 }, { id: "api", runningProcesses: 1, activeRequest: false, liveLease: false, crashCount: 0, lastCrashAt: null }];
  const decision = recoveryDecision({ services, failedServiceId: "worker", now: 100, crashLoopLimit: 3 });
  assert.equal(decision.action, "restart_exact_service");
  assert.equal(decision.serviceId, "worker");
  assert.equal(recoveryDecision({ services: [{ ...services[0]!, activeRequest: true }], failedServiceId: "worker", now: 100, crashLoopLimit: 3 }).action, "wait_for_active_work");
});

test("interruption preserves checkpoints, schedules quota resets, and never repeats completed effects", () => {
  const result = reconcileInterruption({ kind: "restart", checkpointValid: true, partialWriteDetected: false, completedEffectKeys: new Set(["publish"]), pendingEffectKey: "publish", quotaResetAt: null });
  assert.equal(result.repeatExternalEffect, false);
  assert.equal(result.resume, "automatic");
  assert.equal(reconcileInterruption({ kind: "quota", checkpointValid: true, partialWriteDetected: false, completedEffectKeys: new Set(), pendingEffectKey: null, quotaResetAt: 200 }).resume, "scheduled");
  assert.equal(reconcileInterruption({ kind: "restart", checkpointValid: false, partialWriteDetected: true, completedEffectKeys: new Set(), pendingEffectKey: null, quotaResetAt: null }).resume, "read_only_recovery");
});

test("stuck recovery distinguishes active work, recoverable worker loss, needs-user, and quarantine", () => {
  assert.equal(planStuckRecovery({ reason: "active_slow", activeRequest: true, validationActive: false, claimable: false, workerHealthy: true, retryBudgetRemaining: 2 }).state, "healthy_slow");
  assert.equal(planStuckRecovery({ reason: "stopped_service", activeRequest: false, validationActive: false, claimable: true, workerHealthy: false, retryBudgetRemaining: 2 }).state, "recover");
  assert.equal(planStuckRecovery({ reason: "missing_permission", activeRequest: false, validationActive: false, claimable: false, workerHealthy: true, retryBudgetRemaining: 2 }).state, "needs_user");
  assert.equal(planStuckRecovery({ reason: "repeated_failure", activeRequest: false, validationActive: false, claimable: false, workerHealthy: true, retryBudgetRemaining: 0 }).state, "quarantined");
});

test("chaos regressions in integrity, idempotency, or safe terminal state block release", () => {
  const good: ChaosResult = { fault: "provider_429", recovered: true, dataIntegrity: true, duplicateEffects: 0, safeState: true, evidenceRef: "chaos/provider-429.json" };
  assert.equal(releaseGate([good]).allowed, true);
  assert.equal(releaseGate([{ ...good, fault: "duplicate_event", duplicateEffects: 1 }]).allowed, false);
  assert.equal(releaseGate([{ ...good, fault: "disk_pressure", dataIntegrity: false }]).allowed, false);
});
