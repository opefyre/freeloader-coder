export interface CircuitState {
  readonly consecutiveFailures: number;
  readonly openUntil: number;
}

export interface QuotaState {
  readonly windowStart: number;
  readonly requests: number;
  readonly tokens: number;
}

export function recordCircuitSuccess(): CircuitState {
  return { consecutiveFailures: 0, openUntil: 0 };
}

export function recordCircuitFailure(input: {
  readonly state: CircuitState;
  readonly now: number;
  readonly threshold: number;
  readonly cooldownMs: number;
  readonly transient: boolean;
}): CircuitState {
  if (!input.transient) return input.state;
  const consecutiveFailures = input.state.consecutiveFailures + 1;
  return {
    consecutiveFailures,
    openUntil: consecutiveFailures >= input.threshold
      ? input.now + input.cooldownMs
      : input.state.openUntil
  };
}

export function consumeDailyQuota(input: {
  readonly state: QuotaState;
  readonly now: number;
  readonly requestLimit: number;
  readonly tokenLimit: number;
  readonly tokens: number;
}): QuotaState {
  const dayMs = 86_400_000;
  const state = input.now - input.state.windowStart >= dayMs
    ? { windowStart: input.now, requests: 0, tokens: 0 }
    : input.state;
  if (state.requests + 1 > input.requestLimit) throw new Error("Daily request limit reached.");
  if (state.tokens + input.tokens > input.tokenLimit) throw new Error("Daily token limit reached.");
  return {
    windowStart: state.windowStart,
    requests: state.requests + 1,
    tokens: state.tokens + input.tokens
  };
}
