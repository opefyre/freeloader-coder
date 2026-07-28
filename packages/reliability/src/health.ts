export type HealthCondition = "healthy" | "slow" | "stalled" | "degraded" | "unavailable" | "blocked" | "data_risk";

export function evaluateHealth(input: {
  readonly processRunning: boolean;
  readonly safeProgressAt: number | null;
  readonly activeModelAt: number | null;
  readonly activeValidationAt: number | null;
  readonly now: number;
  readonly slowAfterMs: number;
  readonly stalledAfterMs: number;
  readonly dependencyBlocked: boolean;
  readonly dataIntegrityValid: boolean;
}): HealthCondition {
  if (!input.dataIntegrityValid) return "data_risk";
  if (input.dependencyBlocked) return "blocked";
  if (!input.processRunning) return "unavailable";
  const activity = Math.max(input.safeProgressAt ?? -Infinity, input.activeModelAt ?? -Infinity, input.activeValidationAt ?? -Infinity);
  if (!Number.isFinite(activity)) return "stalled";
  const silence = input.now - activity;
  if (silence > input.stalledAfterMs) return "stalled";
  if (silence > input.slowAfterMs) return "slow";
  return "healthy";
}

export function errorBudget(input: { readonly objective: number; readonly total: number; readonly failures: number }): {
  readonly consumed: number;
  readonly remaining: number;
  readonly releaseAllowed: boolean;
} {
  if (input.objective <= 0 || input.objective >= 1 || input.total < 1 || input.failures < 0) throw new Error("SLO input is invalid.");
  const allowedFailures = input.total * (1 - input.objective);
  const consumed = input.failures / allowedFailures;
  return { consumed, remaining: Math.max(0, 1 - consumed), releaseAllowed: consumed <= 1 };
}
