import type { CapacityUnit, ProviderCandidate, RouteDecision } from "./router.js";

export type ProviderHealth = "ready" | "limited" | "cooldown" | "not_configured";

export interface ProviderTelemetry {
  readonly providerId: string;
  readonly modelId: string;
  readonly health: ProviderHealth;
  readonly capacityUnit: CapacityUnit;
  readonly requestsToday: number;
  readonly inputTokensToday: number;
  readonly outputTokensToday: number;
  readonly successfulCalls: number;
  readonly failedCalls: number;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly retryAt: number | null;
  readonly statusDetail: string;
}

export interface ProviderRuntimeEvidence {
  readonly successfulCalls: number;
  readonly failedCalls: number;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
}

export function buildProviderTelemetry(input: {
  readonly candidate: ProviderCandidate;
  readonly runtime: ProviderRuntimeEvidence;
  readonly route?: RouteDecision;
  readonly now: number;
}): ProviderTelemetry {
  const rejection = input.route?.rejected.find(
    (item) => item.candidateId === input.candidate.id
  );
  const health: ProviderHealth = !input.candidate.configured
    ? "not_configured"
    : input.candidate.circuitOpenUntil > input.now
      ? "cooldown"
      : rejection
        ? "limited"
        : "ready";
  return {
    providerId: input.candidate.providerId,
    modelId: input.candidate.modelId,
    health,
    capacityUnit: input.candidate.capacity.unit,
    requestsToday: input.candidate.usage.requestsToday,
    inputTokensToday: input.candidate.usage.inputTokensToday,
    outputTokensToday: input.candidate.usage.outputTokensToday,
    successfulCalls: input.runtime.successfulCalls,
    failedCalls: input.runtime.failedCalls,
    lastSuccessAt: input.runtime.lastSuccessAt,
    lastFailureAt: input.runtime.lastFailureAt,
    retryAt: rejection?.retryAt ?? null,
    statusDetail:
      rejection?.detail ??
      (input.runtime.successfulCalls > 0 ? "Available with confirmed successful calls." : "Configured; no successful call recorded yet.")
  };
}
