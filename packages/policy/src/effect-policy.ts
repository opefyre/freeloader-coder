import { createHash } from "node:crypto";

import {
  capabilityGrantSchema,
  effectApprovalSchema,
  effectDescriptorSchema,
  effectPolicySchema,
  type CapabilityGrant,
  type EffectApproval,
  type EffectCategory,
  type EffectDescriptor,
  type EffectPolicy
} from "../../schemas/src/index.js";

export type ApprovalDecision = "auto_allow" | "ask" | "deny";

export interface EffectAuthorizationDecision {
  readonly allowed: boolean;
  readonly state: "allowed" | "approval_required" | "denied" | "duplicate";
  readonly reason:
    | "auto-policy"
    | "approved"
    | "approval-missing"
    | "approval-stale"
    | "effect-changed"
    | "capability-missing"
    | "capability-expired"
    | "capability-revoked"
    | "project-mismatch"
    | "policy-denied"
    | "duplicate-submission";
  readonly detail: string;
}

export interface EffectClassificationInput {
  readonly location: "local" | "external";
  readonly writes: boolean;
  readonly reversible: boolean;
  readonly consequential: boolean;
  readonly accessesCredential: boolean;
  readonly expandsPermission: boolean;
  readonly destructive: boolean;
  readonly maximumCostMinor: number;
}

export interface ApprovalFact {
  readonly label: "Target" | "Effect" | "Cost" | "Evidence" | "Undo or compensation";
  readonly value: string;
}

export function classifyEffect(input: EffectClassificationInput): EffectCategory {
  if (input.maximumCostMinor > 0) return "paid";
  if (input.destructive) return "destructive";
  if (input.expandsPermission) return "permission_expanding";
  if (input.accessesCredential) return "credential";
  if (!input.writes) return "read_only";
  if (input.location === "external") {
    return input.reversible && !input.consequential
      ? "external_reversible"
      : "external_consequential";
  }
  return input.reversible && !input.consequential
    ? "local_reversible"
    : "local_consequential";
}

export function createRecommendedEffectPolicy(
  projectId: string,
  preset: EffectPolicy["preset"] = "balanced"
): EffectPolicy {
  return effectPolicySchema.parse({
    schemaVersion: 1,
    projectId,
    preset,
    overrides: []
  });
}

export function createEffectApproval(input: {
  readonly id: string;
  readonly effect: EffectDescriptor;
  readonly approvedBy: string;
  readonly approvedAt: number;
  readonly ttlMs: number;
}): EffectApproval {
  return effectApprovalSchema.parse({
    schemaVersion: 1,
    id: input.id,
    projectId: input.effect.projectId,
    effectId: input.effect.id,
    effectDigest: digestEffect(input.effect),
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    expiresAt: input.approvedAt + input.ttlMs,
    revokedAt: null
  });
}

export function evaluateEffectAuthorization(input: {
  readonly policy: EffectPolicy;
  readonly effect: EffectDescriptor;
  readonly grant: CapabilityGrant | null;
  readonly approval: EffectApproval | null;
  readonly now: number;
  readonly completedIdempotencyKeys?: ReadonlySet<string> | undefined;
}): EffectAuthorizationDecision {
  const policy = effectPolicySchema.parse(input.policy);
  const effect = effectDescriptorSchema.parse(input.effect);
  if (input.completedIdempotencyKeys?.has(effect.idempotencyKey)) {
    return decision(false, "duplicate", "duplicate-submission", "This effect already completed; its evidence will be reused.");
  }
  if (policy.projectId !== effect.projectId) {
    return decision(false, "denied", "project-mismatch", "The effect belongs to a different project policy.");
  }
  if (!input.grant) {
    return decision(false, "denied", "capability-missing", "This project has not granted the required capability.");
  }
  const grant = capabilityGrantSchema.parse(input.grant);
  if (grant.projectId !== effect.projectId) {
    return decision(false, "denied", "project-mismatch", "The capability belongs to a different project.");
  }
  if (grant.revokedAt !== null) {
    return decision(false, "denied", "capability-revoked", "This capability was revoked and cannot start new work.");
  }
  if (grant.expiresAt !== null && grant.expiresAt <= input.now) {
    return decision(false, "denied", "capability-expired", "This capability expired and must be reviewed.");
  }
  if (
    !grant.targetKinds.includes(effect.target.kind) ||
    !grant.effectCategories.includes(effect.category)
  ) {
    return decision(false, "denied", "capability-missing", "The grant does not cover this target and effect.");
  }

  const required = policyDecision(policy, effect.category);
  if (required === "deny") {
    return decision(false, "denied", "policy-denied", "Project policy denies this effect.");
  }
  if (required === "auto_allow") {
    return decision(true, "allowed", "auto-policy", "Project policy and capability grant allow this effect.");
  }
  if (!input.approval) {
    return decision(false, "approval_required", "approval-missing", "Review the effect facts before it starts.");
  }
  const approval = effectApprovalSchema.parse(input.approval);
  if (approval.projectId !== effect.projectId || approval.effectId !== effect.id) {
    return decision(false, "approval_required", "effect-changed", "The approval belongs to a different effect.");
  }
  if (approval.revokedAt !== null || approval.expiresAt <= input.now) {
    return decision(false, "approval_required", "approval-stale", "The approval expired or was revoked; review it again.");
  }
  if (approval.effectDigest !== digestEffect(effect)) {
    return decision(false, "approval_required", "effect-changed", "The plan, target, cost, permission, or reversibility changed.");
  }
  return decision(true, "allowed", "approved", "A current user approval matches the complete effect.");
}

export function approvalFactsForEffect(effect: EffectDescriptor): readonly ApprovalFact[] {
  const parsed = effectDescriptorSchema.parse(effect);
  const cost = parsed.cost.mode === "paid"
    ? `${parsed.cost.explanation} Maximum ${parsed.cost.currency} ${((parsed.cost.maximumMinor ?? 0) / 100).toFixed(2)}.`
    : parsed.cost.explanation;
  return [
    { label: "Target", value: parsed.target.display },
    { label: "Effect", value: `${humanCategory(parsed.category)} — ${parsed.action}` },
    { label: "Cost", value: cost },
    { label: "Evidence", value: parsed.evidenceRequirement },
    { label: "Undo or compensation", value: parsed.undoOrCompensation }
  ];
}

export function digestEffect(effect: EffectDescriptor): string {
  const parsed = effectDescriptorSchema.parse(effect);
  const canonical = {
    ...parsed,
    permissions: [...parsed.permissions].sort(),
    redaction: [...parsed.redaction].sort()
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface ActiveEffect {
  readonly id: string;
  readonly stage: "not_started" | "running" | "effect_started";
  readonly category: EffectCategory;
  readonly reversibility: EffectDescriptor["reversibility"];
}

export interface RevocationResult {
  readonly grant: CapabilityGrant;
  readonly blocksNewWork: true;
  readonly activeWork: readonly {
    readonly effectId: string;
    readonly action: "cancel_before_effect" | "pause_after_safe_step" | "observe_until_reconciled";
  }[];
}

export function revokeCapability(input: {
  readonly grant: CapabilityGrant;
  readonly revokedAt: number;
  readonly activeEffects: readonly ActiveEffect[];
}): RevocationResult {
  const grant = capabilityGrantSchema.parse({
    ...input.grant,
    revokedAt: input.revokedAt
  });
  return {
    grant,
    blocksNewWork: true,
    activeWork: input.activeEffects.map((effect) => ({
      effectId: effect.id,
      action: effect.stage === "not_started"
        ? "cancel_before_effect"
        : effect.stage === "effect_started" &&
            ["external_consequential", "destructive", "paid"].includes(effect.category)
          ? "observe_until_reconciled"
          : "pause_after_safe_step"
    }))
  };
}

export function expireCapabilityLater(
  grant: CapabilityGrant,
  expiresAt: number
): CapabilityGrant {
  return capabilityGrantSchema.parse({
    ...grant,
    expiresAt
  });
}

function policyDecision(policy: EffectPolicy, category: EffectCategory): ApprovalDecision {
  const override = policy.overrides.find((entry) => entry.category === category)?.decision;
  const immutableAsk = ["credential", "permission_expanding", "destructive"].includes(category);
  if (category === "paid") return override === "ask" ? "ask" : "deny";
  if (immutableAsk) return override === "deny" ? "deny" : "ask";
  if (override) return override;
  if (category === "read_only") return "auto_allow";
  if (policy.preset === "guided") return "ask";
  if (policy.preset === "balanced") {
    return category === "local_reversible" ? "auto_allow" : "ask";
  }
  return ["local_reversible", "local_consequential", "external_reversible"].includes(category)
    ? "auto_allow"
    : "ask";
}

function decision(
  allowed: boolean,
  state: EffectAuthorizationDecision["state"],
  reason: EffectAuthorizationDecision["reason"],
  detail: string
): EffectAuthorizationDecision {
  return { allowed, state, reason, detail };
}

function humanCategory(category: EffectCategory): string {
  return category.replaceAll("_", " ");
}
