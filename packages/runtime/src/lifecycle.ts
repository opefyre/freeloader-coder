import { createHash, randomUUID } from "node:crypto";

import {
  controllerLeaseSchema,
  repairPlanSchema,
  type ControllerLease,
  type InterruptedEffect,
  type RepairPlan,
  type RuntimeService,
} from "./contracts.js";

export function acquireControllerLease(input: {
  readonly current: ControllerLease | null;
  readonly profileId: string;
  readonly ownerId?: string;
  readonly pid: number;
  readonly port: number;
  readonly now: number;
  readonly durationMs?: number;
}): ControllerLease {
  const current = input.current
    ? controllerLeaseSchema.parse(input.current)
    : null;
  const ownerId = input.ownerId ?? randomUUID();
  if (
    current &&
    current.profileId === input.profileId &&
    current.expiresAt > input.now &&
    current.ownerId !== ownerId
  ) {
    throw new Error("This profile already has an authoritative controller.");
  }
  const durationMs = input.durationMs ?? 30_000;
  if (durationMs < 5_000 || durationMs > 300_000) {
    throw new Error("Controller lease duration is outside the supported bound.");
  }
  return controllerLeaseSchema.parse({
    schemaVersion: 1,
    profileId: input.profileId,
    ownerId,
    pid: input.pid,
    loopbackHost: "127.0.0.1",
    port: input.port,
    acquiredAt: current?.ownerId === ownerId ? current.acquiredAt : input.now,
    expiresAt: input.now + durationMs,
  });
}

export function checkpointServicesBeforeInterruption(
  services: readonly RuntimeService[],
  checkpointId: string
): readonly RuntimeService[] {
  if (!checkpointId) throw new Error("Interruption checkpoint is required.");
  return services.map((service) => ({
    ...service,
    state: service.state === "stopped" ? "stopped" : "draining",
    lastCheckpointId: checkpointId,
  }));
}

export interface ReconciledEffect {
  readonly effectId: string;
  readonly outcome: "resume" | "outcome_unknown" | "complete";
  readonly mayExecute: boolean;
  readonly evidence: string;
}

export function reconcileInterruptedEffects(
  effects: readonly InterruptedEffect[]
): readonly ReconciledEffect[] {
  const seen = new Set<string>();
  return effects.map((effect) => {
    if (seen.has(effect.idempotencyKey)) {
      throw new Error("Duplicate idempotency key in interrupted effects.");
    }
    seen.add(effect.idempotencyKey);
    if (effect.state === "postcondition_verified") {
      return {
        effectId: effect.effectId,
        outcome: "complete",
        mayExecute: false,
        evidence: "The observable postcondition was already verified.",
      };
    }
    if (effect.state === "attempted") {
      return {
        effectId: effect.effectId,
        outcome: "outcome_unknown",
        mayExecute: false,
        evidence:
          "The effect was attempted without a verified postcondition; user-safe reconciliation is required.",
      };
    }
    return {
      effectId: effect.effectId,
      outcome: "resume",
      mayExecute: true,
      evidence: "No attempt was recorded; the original idempotency key may resume.",
    };
  });
}

export function buildRepairPlan(input: {
  readonly staleController: boolean;
  readonly portConflict: boolean;
  readonly projectionNeedsRebuild: boolean;
  readonly interruptedEffects: readonly InterruptedEffect[];
  readonly unsafeStorageFailure?: boolean;
}): RepairPlan {
  const reconciled = reconcileInterruptedEffects(input.interruptedEffects);
  const unknown = reconciled.filter((effect) => effect.outcome === "outcome_unknown");
  if (input.unsafeStorageFailure) {
    return repairPlanSchema.parse({
      schemaVersion: 1,
      state: "needs_user",
      summary: "Automatic repair stopped before changing canonical storage.",
      actions: [],
      blocker:
        "Storage integrity could not be proven. Export diagnostics and choose a verified backup before resuming.",
      resumable: true,
    });
  }
  const actions: RepairPlan["actions"][number][] = [];
  if (input.staleController) {
    actions.push(action("release_stale_lock", "Remove only the expired controller lock."));
  }
  if (input.portConflict) {
    actions.push(action("select_free_port", "Select a free loopback-only port."));
  }
  if (input.projectionNeedsRebuild) {
    actions.push(
      action("rebuild_projection", "Rebuild derived views from the authoritative event journal.")
    );
  }
  if (unknown.length > 0) {
    actions.push(
      action(
        "preserve_interrupted_effect",
        `Preserve ${unknown.length} uncertain effect${unknown.length === 1 ? "" : "s"} for explicit reconciliation.`
      )
    );
  }
  actions.push(
    action("restart_service", "Restart the stopped local service after prerequisites pass.")
  );
  return repairPlanSchema.parse({
    schemaVersion: 1,
    state: unknown.length > 0 ? "needs_user" : "safe_to_apply",
    summary:
      unknown.length > 0
        ? "Routine runtime repair is ready, but an attempted effect needs your decision."
        : "One-click repair can restore the local runtime without deleting projects or secrets.",
    actions,
    blocker:
      unknown.length > 0
        ? "An external or file effect was attempted without a verified outcome."
        : null,
    resumable: true,
  });
}

export function runtimeStateDigest(input: {
  readonly lease: ControllerLease | null;
  readonly services: readonly RuntimeService[];
  readonly effects: readonly InterruptedEffect[];
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function action(
  id: RepairPlan["actions"][number]["id"],
  effect: string
): RepairPlan["actions"][number] {
  return {
    id,
    effect,
    preservesProjects: true,
    preservesSecrets: true,
  };
}

