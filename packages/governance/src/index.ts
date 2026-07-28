import { z } from "zod";

const version = z.literal(1);
const isoDate = z.string().datetime();
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]+$/);

export const governanceRoleSchema = z.strictObject({
  schemaVersion: version,
  id: identifier,
  title: z.string().min(2).max(80),
  responsibilities: z.array(z.string().min(4).max(240)).min(1).max(20),
  authority: z.array(z.string().min(4).max(240)).min(1).max(20),
  selectedBy: z.string().min(4).max(160),
  term: z.string().min(4).max(120),
  activeHolder: z.string().min(2).max(120).nullable(),
  fallbackRoleId: identifier.nullable(),
});
export type GovernanceRole = z.infer<typeof governanceRoleSchema>;

export const decisionRecordSchema = z.strictObject({
  schemaVersion: version,
  id: z.string().regex(/^adr-\d{4}$/),
  title: z.string().min(4).max(160),
  state: z.enum(["proposed", "accepted", "superseded", "rejected"]),
  decidedAt: isoDate.nullable(),
  owners: z.array(identifier).min(1).max(10),
  releaseIds: z.array(z.string().regex(/^release-[a-z0-9.-]+$/)).max(20),
  context: z.string().min(10).max(2_000),
  decision: z.string().min(10).max(2_000),
  consequences: z.array(z.string().min(5).max(400)).min(1).max(20),
  sourcePath: z.string().regex(/^docs\/decisions\/[a-z0-9._/-]+\.md$/),
});
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

export const governancePolicySchema = z.strictObject({
  schemaVersion: version,
  reviewedAt: isoDate,
  nextReviewAt: isoDate,
  roles: z.array(governanceRoleSchema).min(2).max(20),
  decisions: z.array(decisionRecordSchema).min(1).max(500),
  roadmapProcessDefined: z.boolean(),
  triageProcessDefined: z.boolean(),
  moderationProcessDefined: z.boolean(),
  successionProcessDefined: z.boolean(),
  securityEmergencyProcessDefined: z.boolean(),
  officialAdapterRuleDefined: z.boolean(),
  conflictDisclosurePath: z.string().regex(/^docs\/[a-z0-9._/-]+\.md$/),
  fundingDisclosurePath: z.string().regex(/^docs\/[a-z0-9._/-]+\.md$/),
});
export type GovernancePolicy = z.infer<typeof governancePolicySchema>;

export interface GovernanceAssessment {
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly releaseLinkedDecisions: number;
  readonly documentedFallbacks: number;
}

export function assessGovernance(raw: unknown, now: string): GovernanceAssessment {
  const policy = governancePolicySchema.parse(raw);
  const uniqueRoleIds = new Set(policy.roles.map((role) => role.id));
  const missingFallbacks = policy.roles.filter(
    (role) =>
      role.fallbackRoleId !== null && !uniqueRoleIds.has(role.fallbackRoleId)
  );
  const stale = policy.nextReviewAt < now;
  const requiredProcesses = [
    ["Roadmap process", policy.roadmapProcessDefined],
    ["Issue triage process", policy.triageProcessDefined],
    ["Moderation process", policy.moderationProcessDefined],
    ["Maintainer succession", policy.successionProcessDefined],
    ["Security emergency process", policy.securityEmergencyProcessDefined],
    ["Official adapter rule", policy.officialAdapterRuleDefined],
  ] as const;
  const blockers = [
    ...requiredProcesses
      .filter(([, defined]) => !defined)
      .map(([label]) => `${label} is not defined.`),
    ...(missingFallbacks.length > 0
      ? ["One or more governance fallbacks reference an unknown role."]
      : []),
  ];
  const warnings = [
    ...(stale ? ["The governance review is overdue."] : []),
    ...(policy.roles.every((role) => role.activeHolder === null)
      ? ["Roles are defined, but no current holders are declared."]
      : []),
  ];
  return {
    ready: blockers.length === 0 && warnings.length === 0,
    blockers,
    warnings,
    releaseLinkedDecisions: policy.decisions.filter(
      (decision) => decision.releaseIds.length > 0
    ).length,
    documentedFallbacks: policy.roles.filter(
      (role) => role.fallbackRoleId !== null
    ).length,
  };
}

export const supplyChainCheckSchema = z.strictObject({
  schemaVersion: version,
  id: identifier,
  category: z.enum([
    "dependency",
    "secret",
    "build",
    "artifact",
    "provenance",
    "signature",
    "license",
  ]),
  label: z.string().min(3).max(120),
  required: z.boolean(),
  state: z.enum(["passed", "failed", "stale", "not_run"]),
  observedAt: isoDate.nullable(),
  evidenceRef: z.string().min(3).max(240).nullable(),
  remediation: z.string().min(5).max(400),
});
export type SupplyChainCheck = z.infer<typeof supplyChainCheckSchema>;

export const supplyChainGateSchema = z.strictObject({
  schemaVersion: version,
  gateId: z.string().regex(/^supply-[a-z0-9.-]+$/),
  releaseId: z.string().regex(/^release-[a-z0-9.-]+$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{7,40}$/),
  lockfileDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  checks: z.array(supplyChainCheckSchema).min(7).max(100),
  allowedLicenses: z.array(z.string().min(2).max(80)).min(1).max(100),
  deniedPackages: z.array(z.string().min(1).max(214)).max(500),
  generatedAt: isoDate,
});
export type SupplyChainGate = z.infer<typeof supplyChainGateSchema>;

export interface SupplyChainAssessment {
  readonly promotable: boolean;
  readonly failures: readonly SupplyChainCheck[];
  readonly stale: readonly SupplyChainCheck[];
  readonly pending: readonly SupplyChainCheck[];
  readonly passedCount: number;
  readonly action: string;
}

export function verifySupplyChain(raw: unknown): SupplyChainAssessment {
  const gate = supplyChainGateSchema.parse(raw);
  const required = gate.checks.filter((check) => check.required);
  const failures = required.filter((check) => check.state === "failed");
  const stale = required.filter((check) => check.state === "stale");
  const pending = required.filter((check) => check.state === "not_run");
  const promotable =
    failures.length === 0 && stale.length === 0 && pending.length === 0;
  return {
    promotable,
    failures,
    stale,
    pending,
    passedCount: gate.checks.filter((check) => check.state === "passed").length,
    action: promotable
      ? "Attach this evidence to the release candidate."
      : failures[0]?.remediation ??
        stale[0]?.remediation ??
        pending[0]?.remediation ??
        "Inspect the supply-chain evidence.",
  };
}

export const dataFlowSchema = z.strictObject({
  schemaVersion: version,
  id: identifier,
  category: z.enum([
    "operational",
    "optional_telemetry",
    "third_party_ai",
    "support_bundle",
  ]),
  data: z.array(z.string().min(2).max(160)).min(1).max(30),
  destination: z.string().min(2).max(160),
  purpose: z.string().min(5).max(400),
  defaultEnabled: z.boolean(),
  requiresConsent: z.boolean(),
  retention: z.string().min(2).max(160),
  deletionSupported: z.boolean(),
  containsSecrets: z.literal(false),
  containsPersonalData: z.boolean(),
});
export type DataFlow = z.infer<typeof dataFlowSchema>;

export const privacyPreferencesSchema = z.strictObject({
  schemaVersion: version,
  optionalTelemetry: z.boolean(),
  thirdPartyTrainingEligible: z.boolean(),
  supportDiagnostics: z.boolean(),
  paidUsage: z.literal(false),
  updatedAt: isoDate,
});
export type PrivacyPreferences = z.infer<typeof privacyPreferencesSchema>;

export interface ConsentChange {
  readonly next: PrivacyPreferences;
  readonly prospectiveOnly: true;
  readonly deletionAvailable: boolean;
  readonly effects: readonly string[];
}

export function changeConsent(
  raw: unknown,
  action:
    | "enable_telemetry"
    | "disable_telemetry"
    | "allow_training"
    | "deny_training"
    | "enable_support"
    | "disable_support",
  updatedAt: string,
  flows: readonly DataFlow[]
): ConsentChange {
  const current = privacyPreferencesSchema.parse(raw);
  const next = {
    ...current,
    optionalTelemetry:
      action === "enable_telemetry"
        ? true
        : action === "disable_telemetry"
          ? false
          : current.optionalTelemetry,
    thirdPartyTrainingEligible:
      action === "allow_training"
        ? true
        : action === "deny_training"
          ? false
          : current.thirdPartyTrainingEligible,
    supportDiagnostics:
      action === "enable_support"
        ? true
        : action === "disable_support"
          ? false
          : current.supportDiagnostics,
    updatedAt,
  } satisfies PrivacyPreferences;
  return {
    next: privacyPreferencesSchema.parse(next),
    prospectiveOnly: true,
    deletionAvailable: flows
      .filter((flow) => flow.requiresConsent)
      .every((flow) => flow.deletionSupported),
    effects: consentEffects(current, next),
  };
}

function consentEffects(
  current: PrivacyPreferences,
  next: PrivacyPreferences
): readonly string[] {
  const effects: string[] = [];
  if (current.optionalTelemetry !== next.optionalTelemetry) {
    effects.push(
      next.optionalTelemetry
        ? "Future anonymous product signals may be sent."
        : "Future optional telemetry will stay local."
    );
  }
  if (
    current.thirdPartyTrainingEligible !== next.thirdPartyTrainingEligible
  ) {
    effects.push(
      next.thirdPartyTrainingEligible
        ? "Eligible non-sensitive prompts may use training-eligible routes."
        : "Training-eligible third-party routes are no longer allowed."
    );
  }
  if (current.supportDiagnostics !== next.supportDiagnostics) {
    effects.push(
      next.supportDiagnostics
        ? "Redacted diagnostics may be prepared when you request support."
        : "Support diagnostics will not be retained."
    );
  }
  return effects.length > 0 ? effects : ["No consent setting changed."];
}
