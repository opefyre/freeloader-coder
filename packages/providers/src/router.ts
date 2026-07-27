export type PrivacyLevel = "training_eligible" | "no_training" | "zero_retention" | "local";
export type DataClass = "public_test" | "non_personal_test" | "source_code" | "personal" | "credential";

export interface ProviderCandidate {
  readonly id: string;
  readonly priority: number;
  readonly privacy: PrivacyLevel;
  readonly location: "local" | "external";
  readonly paid: boolean;
  readonly roles: readonly string[];
  readonly kinds: readonly string[];
  readonly dataClasses: readonly DataClass[];
  readonly dailyTokenLimit: number;
  readonly usedTokens: number;
  readonly circuitOpenUntil: number;
}

export interface RouteRequest {
  readonly role: string;
  readonly kind: string;
  readonly dataClass: DataClass;
  readonly minimumPrivacy: PrivacyLevel;
  readonly estimatedTokens: number;
  readonly allowPaid: boolean;
  readonly now: number;
  readonly preferredProviderIds?: readonly string[];
  readonly avoidedProviderIds?: readonly string[];
}

export interface RouteDecision {
  readonly selected: ProviderCandidate | null;
  readonly eligible: readonly ProviderCandidate[];
  readonly rejected: readonly { providerId: string; reason: string }[];
}

const privacyRank: Readonly<Record<PrivacyLevel, number>> = {
  training_eligible: 0,
  no_training: 1,
  zero_retention: 2,
  local: 3
};

export function routeProviders(
  candidates: readonly ProviderCandidate[],
  request: RouteRequest
): RouteDecision {
  const preferred = new Set(request.preferredProviderIds ?? []);
  const avoided = new Set(request.avoidedProviderIds ?? []);
  const eligible: ProviderCandidate[] = [];
  const rejected: { providerId: string; reason: string }[] = [];

  for (const candidate of candidates) {
    const reason = rejectionReason(candidate, request, avoided);
    if (reason) rejected.push({ providerId: candidate.id, reason });
    else eligible.push(candidate);
  }

  eligible.sort((left, right) => {
    const preferredDifference = Number(preferred.has(right.id)) - Number(preferred.has(left.id));
    if (preferredDifference !== 0) return preferredDifference;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.id.localeCompare(right.id);
  });

  return { selected: eligible[0] ?? null, eligible, rejected };
}

function rejectionReason(
  candidate: ProviderCandidate,
  request: RouteRequest,
  avoided: ReadonlySet<string>
): string | null {
  if (avoided.has(candidate.id)) return "avoided";
  if (candidate.paid && !request.allowPaid) return "paid-disabled";
  if (!candidate.roles.includes(request.role)) return "role-not-allowed";
  if (!candidate.kinds.includes(request.kind)) return "kind-not-allowed";
  if (!candidate.dataClasses.includes(request.dataClass)) return "data-class-not-allowed";
  if (
    ["personal", "credential"].includes(request.dataClass)
    && candidate.location !== "local"
  ) return "sensitive-data-requires-local";
  if (privacyRank[candidate.privacy] < privacyRank[request.minimumPrivacy]) {
    return "privacy-insufficient";
  }
  if (candidate.circuitOpenUntil > request.now) return "circuit-open";
  if (candidate.usedTokens + request.estimatedTokens > candidate.dailyTokenLimit) {
    return "daily-token-limit";
  }
  return null;
}
