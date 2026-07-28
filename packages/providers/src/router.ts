export type PrivacyLevel = "training_eligible" | "no_training" | "zero_retention" | "local";
export type DataClass = "public_test" | "non_personal_test" | "source_code" | "personal" | "credential";
export type CapacityUnit = "requests" | "tokens" | "neurons" | "provider_reported" | "unmetered";

export interface ProviderCapacityPolicy {
  readonly unit: CapacityUnit;
  readonly requestsPerMinute?: number;
  readonly requestsPerDay?: number;
  readonly tokensPerMinute?: number;
  readonly tokensPerDay?: number;
  readonly freeUnitsPerDay?: number;
  readonly inputUnitsPerMillion?: number;
  readonly outputUnitsPerMillion?: number;
}

export interface ProviderCapacityUsage {
  readonly requestsToday: number;
  readonly tokensToday: number;
  readonly inputTokensToday: number;
  readonly outputTokensToday: number;
  readonly freeUnitsToday?: number;
  readonly requestTimestamps: readonly number[];
  readonly tokenSamples: readonly { readonly at: number; readonly tokens: number }[];
  readonly providerRemainingRequests?: number | null;
  readonly providerRemainingTokens?: number | null;
  readonly providerResetAt?: number | null;
}

export interface ProviderCandidate {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly priority: number;
  readonly configured: boolean;
  readonly privacy: PrivacyLevel;
  readonly location: "local" | "external";
  readonly paid: boolean;
  readonly roles: readonly string[];
  readonly kinds: readonly string[];
  readonly dataClasses: readonly DataClass[];
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly capacity: ProviderCapacityPolicy;
  readonly usage: ProviderCapacityUsage;
  readonly circuitOpenUntil: number;
}

export interface RouteRequest {
  readonly role: string;
  readonly kind: string;
  readonly dataClass: DataClass;
  readonly minimumPrivacy: PrivacyLevel;
  readonly estimatedInputTokens: number;
  readonly requestedOutputTokens: number;
  readonly allowPaid: boolean;
  readonly now: number;
  readonly preferredProviderIds?: readonly string[];
  readonly avoidedProviderIds?: readonly string[];
}

export type RouteRejectionReason =
  | "provider-not-configured"
  | "avoided"
  | "paid-disabled"
  | "role-not-allowed"
  | "kind-not-allowed"
  | "data-class-not-allowed"
  | "sensitive-data-requires-local"
  | "privacy-insufficient"
  | "input-too-large"
  | "circuit-open"
  | "minute-request-limit"
  | "minute-token-limit"
  | "daily-request-limit"
  | "daily-token-limit"
  | "daily-free-budget-limit"
  | "provider-reported-exhausted";

export interface RouteRejection {
  readonly candidateId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly reason: RouteRejectionReason;
  readonly retryAt: number | null;
  readonly detail: string;
}

export interface RouteDecision {
  readonly selected: ProviderCandidate | null;
  readonly eligible: readonly ProviderCandidate[];
  readonly rejected: readonly RouteRejection[];
}

export interface CapacityDecision {
  readonly allowed: boolean;
  readonly reason: RouteRejectionReason | null;
  readonly retryAt: number | null;
  readonly projectedFreeUnits: number | null;
}

const privacyRank: Readonly<Record<PrivacyLevel, number>> = {
  training_eligible: 0,
  no_training: 1,
  zero_retention: 2,
  local: 3
};

export function validateRouteCandidates(candidates: readonly ProviderCandidate[]): void {
  if (candidates.length === 0) throw new Error("A route requires at least one candidate.");
  const identities = new Set<string>();
  for (const candidate of candidates) {
    const identity = `${candidate.providerId}:${candidate.modelId}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate provider-model candidate: ${identity}`);
    }
    identities.add(identity);
    if (candidate.contextWindowTokens <= candidate.maxOutputTokens) {
      throw new Error(`Candidate ${candidate.id} has no usable input context.`);
    }
    validateCapacityPolicy(candidate.capacity, candidate.id);
  }
}

export function routeProviders(
  candidates: readonly ProviderCandidate[],
  request: RouteRequest
): RouteDecision {
  validateRouteCandidates(candidates);
  if (request.estimatedInputTokens < 0 || request.requestedOutputTokens < 1) {
    throw new Error("Projected route tokens are invalid.");
  }
  const preferred = new Set(request.preferredProviderIds ?? []);
  const avoided = new Set(request.avoidedProviderIds ?? []);
  const eligible: ProviderCandidate[] = [];
  const rejected: RouteRejection[] = [];

  for (const candidate of candidates) {
    const rejection = rejectionFor(candidate, request, avoided);
    if (rejection) rejected.push(rejection);
    else eligible.push(candidate);
  }

  eligible.sort((left, right) => {
    const preferredDifference =
      Number(preferred.has(right.providerId)) - Number(preferred.has(left.providerId));
    if (preferredDifference !== 0) return preferredDifference;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.id.localeCompare(right.id);
  });

  return { selected: eligible[0] ?? null, eligible, rejected };
}

export function evaluateCapacity(
  candidate: ProviderCandidate,
  request: Pick<RouteRequest, "estimatedInputTokens" | "requestedOutputTokens" | "now">
): CapacityDecision {
  const { capacity, usage } = candidate;
  const minuteStart = request.now - 60_000;
  const minuteRequests = usage.requestTimestamps.filter((timestamp) => timestamp > minuteStart).length;
  if (capacity.requestsPerMinute && minuteRequests >= capacity.requestsPerMinute) {
    return {
      allowed: false,
      reason: "minute-request-limit",
      retryAt: earliestMinuteReset(usage.requestTimestamps, request.now),
      projectedFreeUnits: null
    };
  }
  const minuteTokens = usage.tokenSamples
    .filter((sample) => sample.at > minuteStart)
    .reduce((sum, sample) => sum + sample.tokens, 0);
  const projectedTokens = request.estimatedInputTokens + request.requestedOutputTokens;
  if (capacity.tokensPerMinute && minuteTokens + projectedTokens > capacity.tokensPerMinute) {
    return {
      allowed: false,
      reason: "minute-token-limit",
      retryAt: earliestMinuteReset(usage.tokenSamples.map((sample) => sample.at), request.now),
      projectedFreeUnits: null
    };
  }
  if (capacity.requestsPerDay && usage.requestsToday >= capacity.requestsPerDay) {
    return {
      allowed: false,
      reason: "daily-request-limit",
      retryAt: nextUtcDay(request.now),
      projectedFreeUnits: null
    };
  }
  if (capacity.tokensPerDay && usage.tokensToday + projectedTokens > capacity.tokensPerDay) {
    return {
      allowed: false,
      reason: "daily-token-limit",
      retryAt: nextUtcDay(request.now),
      projectedFreeUnits: null
    };
  }
  if (
    usage.providerRemainingRequests !== undefined &&
    usage.providerRemainingRequests !== null &&
    usage.providerRemainingRequests < 1
  ) {
    return {
      allowed: false,
      reason: "provider-reported-exhausted",
      retryAt: usage.providerResetAt ?? null,
      projectedFreeUnits: null
    };
  }
  if (
    usage.providerRemainingTokens !== undefined &&
    usage.providerRemainingTokens !== null &&
    usage.providerRemainingTokens < projectedTokens
  ) {
    return {
      allowed: false,
      reason: "provider-reported-exhausted",
      retryAt: usage.providerResetAt ?? null,
      projectedFreeUnits: null
    };
  }
  const projectedFreeUnits = projectFreeUnits(capacity, request);
  if (
    projectedFreeUnits !== null &&
    capacity.freeUnitsPerDay &&
    (usage.freeUnitsToday ?? deriveUsedFreeUnits(capacity, usage)) + projectedFreeUnits >
      capacity.freeUnitsPerDay
  ) {
    return {
      allowed: false,
      reason: "daily-free-budget-limit",
      retryAt: nextUtcDay(request.now),
      projectedFreeUnits
    };
  }
  return { allowed: true, reason: null, retryAt: null, projectedFreeUnits };
}

function rejectionFor(
  candidate: ProviderCandidate,
  request: RouteRequest,
  avoided: ReadonlySet<string>
): RouteRejection | null {
  const reject = (
    reason: RouteRejectionReason,
    detail: string,
    retryAt: number | null = null
  ): RouteRejection => ({
    candidateId: candidate.id,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    reason,
    retryAt,
    detail
  });
  if (!candidate.configured) return reject("provider-not-configured", "Provider credentials are not configured.");
  if (avoided.has(candidate.providerId)) return reject("avoided", "Provider was excluded for this request.");
  if (candidate.paid && !request.allowPaid) return reject("paid-disabled", "Paid usage is disabled.");
  if (!candidate.roles.includes(request.role)) return reject("role-not-allowed", `Role ${request.role} is unsupported.`);
  if (!candidate.kinds.includes(request.kind)) return reject("kind-not-allowed", `Kind ${request.kind} is unsupported.`);
  if (!candidate.dataClasses.includes(request.dataClass)) {
    return reject("data-class-not-allowed", `Data class ${request.dataClass} is unsupported.`);
  }
  if (["personal", "credential"].includes(request.dataClass) && candidate.location !== "local") {
    return reject("sensitive-data-requires-local", "Sensitive data must remain on a local provider.");
  }
  if (privacyRank[candidate.privacy] < privacyRank[request.minimumPrivacy]) {
    return reject("privacy-insufficient", `Provider privacy is below ${request.minimumPrivacy}.`);
  }
  const maximumInput = candidate.contextWindowTokens - candidate.maxOutputTokens;
  if (request.estimatedInputTokens > maximumInput) {
    return reject(
      "input-too-large",
      `Estimated input ${request.estimatedInputTokens} exceeds safe maximum ${maximumInput}.`
    );
  }
  if (candidate.circuitOpenUntil > request.now) {
    return reject("circuit-open", "Provider circuit is cooling down.", candidate.circuitOpenUntil);
  }
  const capacity = evaluateCapacity(candidate, request);
  return capacity.allowed
    ? null
    : reject(capacity.reason as RouteRejectionReason, capacityDetail(candidate, capacity), capacity.retryAt);
}

function capacityDetail(candidate: ProviderCandidate, decision: CapacityDecision): string {
  if (decision.reason === "daily-free-budget-limit") {
    return `${candidate.capacity.unit} free budget would be exceeded by this request.`;
  }
  const descriptions: Partial<Record<RouteRejectionReason, string>> = {
    "minute-request-limit": "The provider's per-minute request allowance is cooling down.",
    "minute-token-limit": "The provider's per-minute token allowance is cooling down.",
    "daily-request-limit": "The provider's free daily request allowance has been used.",
    "daily-token-limit": "The provider's free daily token allowance has been used.",
    "provider-reported-exhausted": "The provider reports that its current free allowance is exhausted."
  };
  return descriptions[decision.reason ?? "provider-reported-exhausted"]
    ?? "The provider is temporarily unavailable.";
}

function projectFreeUnits(
  capacity: ProviderCapacityPolicy,
  request: Pick<RouteRequest, "estimatedInputTokens" | "requestedOutputTokens">
): number | null {
  if (
    capacity.unit !== "neurons" ||
    !capacity.inputUnitsPerMillion ||
    !capacity.outputUnitsPerMillion
  ) return null;
  return (
    request.estimatedInputTokens * capacity.inputUnitsPerMillion +
    request.requestedOutputTokens * capacity.outputUnitsPerMillion
  ) / 1_000_000;
}

function deriveUsedFreeUnits(
  capacity: ProviderCapacityPolicy,
  usage: ProviderCapacityUsage
): number {
  if (!capacity.inputUnitsPerMillion || !capacity.outputUnitsPerMillion) return 0;
  return (
    usage.inputTokensToday * capacity.inputUnitsPerMillion +
    usage.outputTokensToday * capacity.outputUnitsPerMillion
  ) / 1_000_000;
}

function validateCapacityPolicy(capacity: ProviderCapacityPolicy, candidateId: string): void {
  for (const value of [
    capacity.requestsPerMinute,
    capacity.requestsPerDay,
    capacity.tokensPerMinute,
    capacity.tokensPerDay,
    capacity.freeUnitsPerDay,
    capacity.inputUnitsPerMillion,
    capacity.outputUnitsPerMillion
  ]) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`Candidate ${candidateId} has an invalid capacity limit.`);
    }
  }
  if (
    capacity.unit === "neurons" &&
    (!capacity.freeUnitsPerDay ||
      !capacity.inputUnitsPerMillion ||
      !capacity.outputUnitsPerMillion)
  ) {
    throw new Error(`Candidate ${candidateId} requires complete neuron pricing.`);
  }
}

function earliestMinuteReset(timestamps: readonly number[], now: number): number {
  return timestamps.length === 0 ? now + 60_000 : Math.min(...timestamps) + 60_000;
}

function nextUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
