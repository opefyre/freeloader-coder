export type PaidProviderId = "openai" | "anthropic";
export type PaidRole = "planning" | "implementation" | "review" | "analysis";

export interface PaidBudgetAuthorization {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly providerId: PaidProviderId;
  readonly connectionId: string;
  readonly projectId: string;
  readonly modelId: string;
  readonly roles: readonly PaidRole[];
  readonly currency: "USD" | "EUR" | "GBP";
  readonly perRequestMinor: number;
  readonly perTaskMinor: number;
  readonly dailyMinor: number;
  readonly monthlyMinor: number;
  readonly taskSpentMinor: number;
  readonly dailySpentMinor: number;
  readonly monthlySpentMinor: number;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly emergencyDisabled: boolean;
  readonly confirmationDigest: string;
}

export interface PaidCallProposal {
  readonly providerId: PaidProviderId;
  readonly connectionId: string;
  readonly projectId: string;
  readonly modelId: string;
  readonly role: PaidRole;
  readonly estimatedCostMinor: number;
  readonly confirmationDigest: string;
}

export interface PaidUsageRecord {
  readonly schemaVersion: 1;
  readonly callId: string;
  readonly authorizationId: string;
  readonly providerId: PaidProviderId;
  readonly modelId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly purpose: PaidRole;
  readonly estimatedCostMinor: number;
  readonly actualCostMinor: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly occurredAt: number;
  readonly containsPromptContent: false;
}

export type PaidBudgetDecision =
  | {
      readonly allowed: true;
      readonly authorizationId: string;
      readonly remainingRequestMinor: number;
      readonly remainingTaskMinor: number;
      readonly remainingDailyMinor: number;
      readonly remainingMonthlyMinor: number;
    }
  | {
      readonly allowed: false;
      readonly reason:
        | "not-configured"
        | "emergency-disabled"
        | "revoked"
        | "expired"
        | "route-mismatch"
        | "role-not-approved"
        | "confirmation-invalid"
        | "budget-exhausted";
      readonly detail: string;
    };

const digestPattern = /^[a-f0-9]{64}$/;

export function authorizePaidCall(
  authorization: PaidBudgetAuthorization | null,
  proposal: PaidCallProposal,
  now: number
): PaidBudgetDecision {
  if (!authorization) return denied("not-configured", "No paid-use authorization exists.");
  validateAuthorization(authorization);
  if (authorization.emergencyDisabled) {
    return denied("emergency-disabled", "Emergency shutdown blocks every new paid call.");
  }
  if (authorization.revokedAt !== null) {
    return denied("revoked", "This paid-use authorization was revoked.");
  }
  if (authorization.expiresAt <= now) {
    return denied("expired", "This paid-use authorization expired.");
  }
  if (
    authorization.providerId !== proposal.providerId ||
    authorization.connectionId !== proposal.connectionId ||
    authorization.projectId !== proposal.projectId ||
    authorization.modelId !== proposal.modelId
  ) {
    return denied("route-mismatch", "Authorization does not match the exact paid route.");
  }
  if (!authorization.roles.includes(proposal.role)) {
    return denied("role-not-approved", "The requested role is outside the approved paid scope.");
  }
  if (
    !digestPattern.test(proposal.confirmationDigest) ||
    proposal.confirmationDigest !== authorization.confirmationDigest
  ) {
    return denied("confirmation-invalid", "Final confirmation is missing or belongs to another route.");
  }
  const cost = proposal.estimatedCostMinor;
  if (
    !Number.isInteger(cost) ||
    cost < 1 ||
    cost > authorization.perRequestMinor ||
    authorization.taskSpentMinor + cost > authorization.perTaskMinor ||
    authorization.dailySpentMinor + cost > authorization.dailyMinor ||
    authorization.monthlySpentMinor + cost > authorization.monthlyMinor
  ) {
    return denied("budget-exhausted", "The estimate would exceed at least one hard budget.");
  }
  return {
    allowed: true,
    authorizationId: authorization.authorizationId,
    remainingRequestMinor: authorization.perRequestMinor - cost,
    remainingTaskMinor: authorization.perTaskMinor - authorization.taskSpentMinor - cost,
    remainingDailyMinor: authorization.dailyMinor - authorization.dailySpentMinor - cost,
    remainingMonthlyMinor: authorization.monthlyMinor - authorization.monthlySpentMinor - cost,
  };
}

export function recordPaidUsage(input: Omit<PaidUsageRecord, "schemaVersion" | "containsPromptContent">): PaidUsageRecord {
  if (input.actualCostMinor !== null && input.actualCostMinor < 0) {
    throw new Error("Actual paid usage cannot be negative.");
  }
  if (input.estimatedCostMinor < 1 || !Number.isInteger(input.estimatedCostMinor)) {
    throw new Error("Estimated paid usage must be a positive integer.");
  }
  return {
    schemaVersion: 1,
    ...input,
    containsPromptContent: false,
  };
}

function validateAuthorization(value: PaidBudgetAuthorization): void {
  const amounts = [
    value.perRequestMinor,
    value.perTaskMinor,
    value.dailyMinor,
    value.monthlyMinor,
  ];
  if (amounts.some((amount) => !Number.isInteger(amount) || amount < 1)) {
    throw new Error("Every paid budget must be a positive integer.");
  }
  if (
    value.perRequestMinor > value.perTaskMinor ||
    value.perTaskMinor > value.dailyMinor ||
    value.dailyMinor > value.monthlyMinor
  ) {
    throw new Error("Paid budgets must increase from request to monthly scope.");
  }
  if (value.expiresAt <= value.approvedAt || !digestPattern.test(value.confirmationDigest)) {
    throw new Error("Paid authorization expiry or confirmation is invalid.");
  }
}

function denied(
  reason: Extract<PaidBudgetDecision, { allowed: false }>["reason"],
  detail: string
): PaidBudgetDecision {
  return { allowed: false, reason, detail };
}
