export type FailureClass =
  | "capacity_deferred"
  | "gateway_interrupted"
  | "transient_provider"
  | "rate_limit"
  | "validation"
  | "permission"
  | "policy"
  | "outcome_unknown"
  | "controller_bug";

export interface RetryDecision {
  readonly action: "defer" | "retry" | "quarantine" | "needs_user";
  readonly retryAt: number | null;
  readonly nextAttempt: number;
  readonly consumesTaskAttempt: boolean;
  readonly reason: string;
}

export interface ProviderFailureObservation {
  readonly failureClass: FailureClass;
  readonly retryAt: number | null;
  readonly code: string;
}

export function classifyProviderFailure(input: {
  readonly status: number | null;
  readonly code?: string;
  readonly retryAt?: number | null;
}): ProviderFailureObservation {
  const code = input.code ?? (input.status === null ? "network-error" : `http-${input.status}`);
  if (input.status === 429) {
    return {
      failureClass: "capacity_deferred",
      retryAt: input.retryAt ?? null,
      code
    };
  }
  if (input.status === 499 || ["client-closed-request", "request-cancelled"].includes(code)) {
    return {
      failureClass: "gateway_interrupted",
      retryAt: input.retryAt ?? null,
      code
    };
  }
  if (input.status === 401 || input.status === 403) {
    return { failureClass: "permission", retryAt: null, code };
  }
  if (code === "invalid-provider-output") {
    return { failureClass: "validation", retryAt: null, code };
  }
  if (input.status !== null && input.status >= 400 && input.status < 500) {
    return { failureClass: "policy", retryAt: null, code };
  }
  return {
    failureClass: "transient_provider",
    retryAt: input.retryAt ?? null,
    code
  };
}

export function decideRetry(input: {
  readonly failureClass: FailureClass;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly now: number;
  readonly baseDelayMs: number;
  readonly deterministicJitter: number;
  readonly providerRetryAt?: number | null;
  readonly infrastructureFailureCount?: number;
  readonly maxInfrastructureFailures?: number;
}): RetryDecision {
  if (input.attempt < 1 || input.maxAttempts < 1 || input.baseDelayMs < 0) {
    throw new Error("Retry limits are invalid.");
  }
  if (["capacity_deferred", "rate_limit", "gateway_interrupted"].includes(input.failureClass)) {
    const delay = input.failureClass === "gateway_interrupted"
      ? Math.max(input.baseDelayMs, 30_000)
      : Math.max(input.baseDelayMs, 60_000);
    return {
      action: "defer",
      retryAt: input.providerRetryAt ?? input.now + delay + Math.max(0, input.deterministicJitter),
      nextAttempt: input.attempt,
      consumesTaskAttempt: false,
      reason:
        input.failureClass === "capacity_deferred" || input.failureClass === "rate_limit"
          ? "free provider capacity is temporarily unavailable"
          : "model gateway request was interrupted before a result was known"
    };
  }
  const nextAttempt = input.attempt + 1;
  if (["permission", "policy", "outcome_unknown"].includes(input.failureClass)) {
    return {
      action: "needs_user",
      retryAt: null,
      nextAttempt,
      consumesTaskAttempt: true,
      reason: `${input.failureClass} requires an explicit decision`
    };
  }
  if (input.failureClass === "controller_bug") {
    return {
      action: "quarantine",
      retryAt: null,
      nextAttempt,
      consumesTaskAttempt: true,
      reason: "controller bug requires repair"
    };
  }
  if (
    input.failureClass === "transient_provider" &&
    (input.infrastructureFailureCount ?? 0) >= (input.maxInfrastructureFailures ?? 6)
  ) {
    return {
      action: "needs_user",
      retryAt: null,
      nextAttempt: input.attempt,
      consumesTaskAttempt: false,
      reason: "provider infrastructure repeatedly failed; task remains safe to resume"
    };
  }
  if (input.attempt >= input.maxAttempts) {
    return {
      action: "quarantine",
      retryAt: null,
      nextAttempt,
      consumesTaskAttempt: true,
      reason: "task failure retry budget exhausted"
    };
  }
  const exponent = Math.min(input.attempt - 1, 8);
  const delay = input.baseDelayMs * (2 ** exponent) + Math.max(0, input.deterministicJitter);
  return {
    action: "retry",
    retryAt: input.now + delay,
    nextAttempt,
    consumesTaskAttempt: true,
    reason: "bounded transient retry"
  };
}
