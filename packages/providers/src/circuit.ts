export interface CircuitState {
  readonly consecutiveFailures: number;
  readonly openUntil: number;
  readonly lastFailureAt: number | null;
  readonly lastFailureCode: string | null;
}

export interface CapacityUsageState {
  readonly utcDay: string;
  readonly requestsToday: number;
  readonly inputTokensToday: number;
  readonly outputTokensToday: number;
  readonly freeUnitsToday: number;
  readonly requestTimestamps: readonly number[];
  readonly tokenSamples: readonly { readonly at: number; readonly tokens: number }[];
  readonly providerRemainingRequests: number | null;
  readonly providerRemainingTokens: number | null;
  readonly providerResetAt: number | null;
}

export function recordCircuitSuccess(): CircuitState {
  return {
    consecutiveFailures: 0,
    openUntil: 0,
    lastFailureAt: null,
    lastFailureCode: null
  };
}

export function recordCircuitFailure(input: {
  readonly state: CircuitState;
  readonly now: number;
  readonly threshold: number;
  readonly cooldownMs: number;
  readonly transient: boolean;
  readonly code?: string;
}): CircuitState {
  if (!input.transient) return input.state;
  const consecutiveFailures = input.state.consecutiveFailures + 1;
  return {
    consecutiveFailures,
    openUntil: consecutiveFailures >= input.threshold
      ? input.now + input.cooldownMs
      : input.state.openUntil,
    lastFailureAt: input.now,
    lastFailureCode: input.code ?? "transient-provider-failure"
  };
}

export function emptyCapacityUsage(now: number): CapacityUsageState {
  return {
    utcDay: utcDay(now),
    requestsToday: 0,
    inputTokensToday: 0,
    outputTokensToday: 0,
    freeUnitsToday: 0,
    requestTimestamps: [],
    tokenSamples: [],
    providerRemainingRequests: null,
    providerRemainingTokens: null,
    providerResetAt: null
  };
}

export function recordCapacityUsage(input: {
  readonly state: CapacityUsageState;
  readonly now: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly freeUnits?: number;
  readonly providerRemainingRequests?: number | null;
  readonly providerRemainingTokens?: number | null;
  readonly providerResetAt?: number | null;
}): CapacityUsageState {
  if (input.inputTokens < 0 || input.outputTokens < 0 || (input.freeUnits ?? 0) < 0) {
    throw new Error("Capacity usage cannot be negative.");
  }
  const state = input.state.utcDay === utcDay(input.now)
    ? input.state
    : emptyCapacityUsage(input.now);
  const totalTokens = input.inputTokens + input.outputTokens;
  return {
    utcDay: state.utcDay,
    requestsToday: state.requestsToday + 1,
    inputTokensToday: state.inputTokensToday + input.inputTokens,
    outputTokensToday: state.outputTokensToday + input.outputTokens,
    freeUnitsToday: state.freeUnitsToday + (input.freeUnits ?? 0),
    requestTimestamps: [...state.requestTimestamps.filter((at) => at > input.now - 60_000), input.now],
    tokenSamples: [
      ...state.tokenSamples.filter((sample) => sample.at > input.now - 60_000),
      { at: input.now, tokens: totalTokens }
    ],
    providerRemainingRequests:
      input.providerRemainingRequests === undefined
        ? state.providerRemainingRequests
        : input.providerRemainingRequests,
    providerRemainingTokens:
      input.providerRemainingTokens === undefined
        ? state.providerRemainingTokens
        : input.providerRemainingTokens,
    providerResetAt:
      input.providerResetAt === undefined ? state.providerResetAt : input.providerResetAt
  };
}

export function recordProviderCapacityObservation(input: {
  readonly state: CapacityUsageState;
  readonly remainingRequests?: number | null;
  readonly remainingTokens?: number | null;
  readonly resetAt?: number | null;
}): CapacityUsageState {
  return {
    ...input.state,
    providerRemainingRequests:
      input.remainingRequests === undefined
        ? input.state.providerRemainingRequests
        : input.remainingRequests,
    providerRemainingTokens:
      input.remainingTokens === undefined ? input.state.providerRemainingTokens : input.remainingTokens,
    providerResetAt: input.resetAt === undefined ? input.state.providerResetAt : input.resetAt
  };
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
