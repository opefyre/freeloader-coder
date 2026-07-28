export const paidUseDefault = "disabled" as const;

export type CostMode = "free_only" | "paid_authorized";
export type CurrencyCode = "USD" | "EUR" | "GBP";

export interface PaidUseGrant {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly providerConnectionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly projectId: string;
  readonly currency: CurrencyCode;
  readonly maximumSpendMinor: number;
  readonly spentMinor: number;
  readonly connectionApproved: true;
  readonly routeApproved: true;
  readonly finalConfirmationDigest: string;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface CostPolicy {
  readonly schemaVersion: 1;
  readonly mode: CostMode;
  readonly paidUseGrants: readonly PaidUseGrant[];
}

export interface PaidRouteIdentity {
  readonly providerConnectionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly projectId: string;
  readonly estimatedCostMinor: number;
  readonly finalConfirmationDigest: string;
}

export type PaidUseDenial =
  | "free-only"
  | "authorization-missing"
  | "authorization-mismatch"
  | "authorization-expired"
  | "authorization-revoked"
  | "connection-not-approved"
  | "route-not-approved"
  | "confirmation-invalid"
  | "budget-exceeded";

export type PaidUseDecision =
  | { readonly allowed: true; readonly authorizationId: string; readonly remainingMinor: number }
  | { readonly allowed: false; readonly reason: PaidUseDenial; readonly detail: string };

const sha256Pattern = /^[a-f0-9]{64}$/;

export function createDefaultCostPolicy(): CostPolicy {
  return {
    schemaVersion: 1,
    mode: "free_only",
    paidUseGrants: []
  };
}

export function evaluatePaidUse(
  policy: CostPolicy,
  route: PaidRouteIdentity,
  now: number
): PaidUseDecision {
  if (policy.mode === "free_only") {
    return deny("free-only", "This project is locked to free-only execution.");
  }
  const grant = policy.paidUseGrants.find(
    (candidate) =>
      candidate.providerConnectionId === route.providerConnectionId &&
      candidate.providerId === route.providerId &&
      candidate.modelId === route.modelId &&
      candidate.projectId === route.projectId
  );
  if (!grant) {
    return deny(
      policy.paidUseGrants.length === 0 ? "authorization-missing" : "authorization-mismatch",
      "No paid-use authorization matches this exact connection, provider, model, and project."
    );
  }
  if (grant.revokedAt !== null) {
    return deny("authorization-revoked", "The matching paid-use authorization was revoked.");
  }
  if (grant.expiresAt <= now) {
    return deny("authorization-expired", "The matching paid-use authorization has expired.");
  }
  if (!grant.connectionApproved) {
    return deny("connection-not-approved", "The provider connection was not approved for paid use.");
  }
  if (!grant.routeApproved) {
    return deny("route-not-approved", "Paid routing was not approved for this authorization.");
  }
  if (
    !sha256Pattern.test(grant.finalConfirmationDigest) ||
    grant.finalConfirmationDigest !== route.finalConfirmationDigest
  ) {
    return deny(
      "confirmation-invalid",
      "The final paid-use confirmation is missing, invalid, or belongs to a different route."
    );
  }
  if (
    route.estimatedCostMinor < 1 ||
    grant.spentMinor + route.estimatedCostMinor > grant.maximumSpendMinor
  ) {
    return deny("budget-exceeded", "This request would exceed the authorization's hard budget.");
  }
  return {
    allowed: true,
    authorizationId: grant.authorizationId,
    remainingMinor: grant.maximumSpendMinor - grant.spentMinor - route.estimatedCostMinor
  };
}

function deny(reason: PaidUseDenial, detail: string): PaidUseDecision {
  return { allowed: false, reason, detail };
}
