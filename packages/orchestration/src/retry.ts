export type FailureClass =
  | "transient_provider"
  | "rate_limit"
  | "validation"
  | "permission"
  | "policy"
  | "outcome_unknown"
  | "controller_bug";

export interface RetryDecision {
  readonly action: "retry" | "quarantine" | "needs_user";
  readonly retryAt: number | null;
  readonly nextAttempt: number;
  readonly reason: string;
}

export function decideRetry(input: {
  readonly failureClass: FailureClass;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly now: number;
  readonly baseDelayMs: number;
  readonly deterministicJitter: number;
}): RetryDecision {
  if (input.attempt < 1 || input.maxAttempts < 1 || input.baseDelayMs < 0) {
    throw new Error("Retry limits are invalid.");
  }
  const nextAttempt = input.attempt + 1;
  if (["permission", "policy", "outcome_unknown"].includes(input.failureClass)) {
    return {
      action: "needs_user",
      retryAt: null,
      nextAttempt,
      reason: `${input.failureClass} requires an explicit decision`
    };
  }
  if (input.failureClass === "controller_bug") {
    return { action: "quarantine", retryAt: null, nextAttempt, reason: "controller bug requires repair" };
  }
  if (input.attempt >= input.maxAttempts) {
    return { action: "quarantine", retryAt: null, nextAttempt, reason: "retry budget exhausted" };
  }
  const exponent = Math.min(input.attempt - 1, 8);
  const delay = input.baseDelayMs * (2 ** exponent) + Math.max(0, input.deterministicJitter);
  return {
    action: "retry",
    retryAt: input.now + delay,
    nextAttempt,
    reason: "bounded transient retry"
  };
}
