import { z } from "zod";

import { sha256 as browserSha256 } from "../../conversation/src/sha256.js";

export * from "./launch-readiness.js";

const version = z.literal(1);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const semanticVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/);

export const releaseArtifactSchema = z.strictObject({
  name: z.string().min(1).max(120),
  kind: z.enum(["source", "lockfile", "schema", "sbom", "provenance", "checksums"]),
  digest,
  sizeBytes: z.number().int().nonnegative(),
});
export type ReleaseArtifact = z.infer<typeof releaseArtifactSchema>;

export const releaseManifestSchema = z.strictObject({
  schemaVersion: version,
  releaseId: z.string().regex(/^release-[a-z0-9.-]+$/),
  version: semanticVersion,
  commit: z.string().regex(/^[a-f0-9]{7,40}$/),
  channel: z.enum(["canary", "beta", "stable"]),
  createdAt: z.string().datetime(),
  sourceDateEpoch: z.number().int().nonnegative(),
  artifacts: z.array(releaseArtifactSchema).min(6).max(100),
  requiredChecks: z.array(z.string().min(2).max(80)).min(1).max(50),
  passedChecks: z.array(z.string().min(2).max(80)).max(50),
  signer: z.string().min(3).max(120),
  signatureVerified: z.boolean(),
  previousCompatibleVersion: semanticVersion.nullable(),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export interface ReleaseVerification {
  readonly releasable: boolean;
  readonly missingKinds: readonly ReleaseArtifact["kind"][];
  readonly missingChecks: readonly string[];
  readonly failures: readonly string[];
  readonly manifestDigest: string;
}

export function verifyReleaseManifest(raw: unknown): ReleaseVerification {
  const manifest = releaseManifestSchema.parse(raw);
  const requiredKinds = [
    "source",
    "lockfile",
    "schema",
    "sbom",
    "provenance",
    "checksums",
  ] as const;
  const kinds = new Set(manifest.artifacts.map((artifact) => artifact.kind));
  const missingKinds = requiredKinds.filter((kind) => !kinds.has(kind));
  const passed = new Set(manifest.passedChecks);
  const missingChecks = manifest.requiredChecks.filter((check) => !passed.has(check));
  const duplicateNames = manifest.artifacts
    .map((artifact) => artifact.name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  const failures = [
    ...(!manifest.signatureVerified ? ["Release signature is unverified."] : []),
    ...(duplicateNames.length > 0 ? ["Artifact names are not unique."] : []),
    ...(missingKinds.length > 0 ? ["Required release artifacts are missing."] : []),
    ...(missingChecks.length > 0 ? ["Required release checks have not passed."] : []),
  ];
  return {
    releasable: failures.length === 0,
    missingKinds,
    missingChecks,
    failures,
    manifestDigest: sha256(JSON.stringify(manifest)),
  };
}

export const compatibilityDimensionSchema = z.enum([
  "operating_system",
  "runtime",
  "provider",
  "model",
  "connector",
  "project_type",
]);
export type CompatibilityDimension = z.infer<typeof compatibilityDimensionSchema>;

export const compatibilityEntrySchema = z.strictObject({
  schemaVersion: version,
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  dimension: compatibilityDimensionSchema,
  name: z.string().min(2).max(120),
  constraint: z.string().min(1).max(120),
  state: z.enum(["supported", "experimental", "blocked", "unknown"]),
  reason: z.string().min(5).max(300),
  alternative: z.string().min(5).max(300).nullable(),
  verifiedAt: z.string().datetime().nullable(),
  reviewAfter: z.string().datetime(),
  sourceUrl: z.string().url(),
  owner: z.string().min(2).max(80),
});
export type CompatibilityEntry = z.infer<typeof compatibilityEntrySchema>;

export interface CompatibilityDecision {
  readonly state: "supported" | "experimental" | "blocked" | "unknown" | "stale";
  readonly canProceed: boolean;
  readonly requiresApproval: boolean;
  readonly explanation: string;
  readonly alternative: string | null;
}

export function evaluateCompatibility(
  raw: unknown,
  now: string
): CompatibilityDecision {
  const entry = compatibilityEntrySchema.parse(raw);
  if (entry.reviewAfter < now) {
    return {
      state: "stale",
      canProceed: false,
      requiresApproval: false,
      explanation: "Compatibility evidence is stale and must be refreshed.",
      alternative: entry.alternative ?? "Use a currently verified environment.",
    };
  }
  return {
    state: entry.state,
    canProceed: entry.state === "supported" || entry.state === "experimental",
    requiresApproval: entry.state === "experimental",
    explanation: entry.reason,
    alternative: entry.alternative,
  };
}

export const updateStageSchema = z.enum([
  "available",
  "preflight",
  "checkpointed",
  "migration_preview",
  "applying",
  "verifying",
  "complete",
  "rollback_ready",
  "rolling_back",
  "restored",
  "needs_user",
]);
export type UpdateStage = z.infer<typeof updateStageSchema>;

export const updatePlanSchema = z.strictObject({
  schemaVersion: version,
  updateId: z.string().regex(/^update-[a-z0-9.-]+$/),
  fromVersion: semanticVersion,
  toVersion: semanticVersion,
  stage: updateStageSchema,
  projectCheckpointId: z.string().min(3).max(120).nullable(),
  databaseBackupId: z.string().min(3).max(120).nullable(),
  activeWorkCount: z.number().int().nonnegative(),
  compatibilityState: z.enum(["supported", "experimental", "blocked", "unknown", "stale"]),
  migrations: z.array(z.string().min(3).max(160)).max(30),
  changedFiles: z.array(z.string().min(1).max(240)).max(100),
  requiredDiskBytes: z.number().int().nonnegative(),
  availableDiskBytes: z.number().int().nonnegative(),
  signatureVerified: z.boolean(),
  rollbackVersion: semanticVersion,
  lastVerifiedStage: updateStageSchema,
  interruptionObserved: z.boolean(),
});
export type UpdatePlan = z.infer<typeof updatePlanSchema>;

export interface UpdateDecision {
  readonly allowed: boolean;
  readonly nextStage: UpdateStage;
  readonly blockers: readonly string[];
  readonly preserves: readonly string[];
  readonly action: string;
}

export function inspectUpdate(raw: unknown): UpdateDecision {
  const plan = updatePlanSchema.parse(raw);
  const blockers = [
    ...(plan.activeWorkCount > 0 ? ["Active work must reach a checkpoint."] : []),
    ...(!plan.signatureVerified ? ["The target release signature is unverified."] : []),
    ...(plan.compatibilityState === "blocked" ||
    plan.compatibilityState === "unknown" ||
    plan.compatibilityState === "stale"
      ? ["The current environment is not verified for this release."]
      : []),
    ...(plan.availableDiskBytes < plan.requiredDiskBytes
      ? ["There is not enough free disk for update and rollback."]
      : []),
  ];
  const hasPreservation =
    plan.projectCheckpointId !== null && plan.databaseBackupId !== null;
  if (plan.interruptionObserved) {
    return {
      allowed: false,
      nextStage: hasPreservation ? "rollback_ready" : "needs_user",
      blockers: hasPreservation
        ? ["The update was interrupted before verification completed."]
        : ["The update was interrupted without complete preservation evidence."],
      preserves: preservationFacts(plan),
      action: hasPreservation
        ? "Restore the last compatible version from verified preservation."
        : "Inspect local state and choose a recovery path.",
    };
  }
  return {
    allowed: blockers.length === 0,
    nextStage:
      blockers.length > 0
        ? "needs_user"
        : hasPreservation
          ? "migration_preview"
          : "preflight",
    blockers,
    preserves: preservationFacts(plan),
    action:
      blockers.length > 0
        ? "Resolve the listed blockers without modifying the project."
        : hasPreservation
          ? "Review migrations and changed files."
          : "Create a project checkpoint and database backup.",
  };
}

export function transitionUpdate(
  raw: unknown,
  nextStage: UpdateStage
): UpdatePlan {
  const plan = updatePlanSchema.parse(raw);
  const transitions: Readonly<Record<UpdateStage, readonly UpdateStage[]>> = {
    available: ["preflight", "needs_user"],
    preflight: ["checkpointed", "needs_user"],
    checkpointed: ["migration_preview", "needs_user"],
    migration_preview: ["applying", "needs_user"],
    applying: ["verifying", "rollback_ready", "needs_user"],
    verifying: ["complete", "rollback_ready", "needs_user"],
    complete: [],
    rollback_ready: ["rolling_back", "needs_user"],
    rolling_back: ["restored", "needs_user"],
    restored: [],
    needs_user: ["preflight", "rollback_ready"],
  };
  if (!transitions[plan.stage].includes(nextStage)) {
    throw new Error(`Update cannot move from ${plan.stage} to ${nextStage}.`);
  }
  if (
    ["migration_preview", "applying", "verifying"].includes(nextStage) &&
    (plan.projectCheckpointId === null || plan.databaseBackupId === null)
  ) {
    throw new Error("Update cannot continue without checkpoint and backup evidence.");
  }
  return updatePlanSchema.parse({
    ...plan,
    stage: nextStage,
    lastVerifiedStage:
      nextStage === "complete" || nextStage === "restored"
        ? nextStage
        : plan.lastVerifiedStage,
  });
}

export const rolloutPlanSchema = z.strictObject({
  schemaVersion: version,
  releaseId: z.string().regex(/^release-[a-z0-9.-]+$/),
  stage: z.enum(["draft", "canary", "beta", "stable", "paused", "rolled_back"]),
  cohortPercent: z.number().min(0).max(100),
  minimumCanaryHours: z.number().int().nonnegative(),
  observedCanaryHours: z.number().nonnegative(),
  totalUpdates: z.number().int().nonnegative(),
  failedUpdates: z.number().int().nonnegative(),
  rollbackExercisesPassed: z.boolean(),
  criticalIncidents: z.number().int().nonnegative(),
  evidenceCurrent: z.boolean(),
});
export type RolloutPlan = z.infer<typeof rolloutPlanSchema>;

export function evaluatePromotion(raw: unknown): {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
  readonly nextStage: "canary" | "beta" | "stable" | null;
} {
  const plan = rolloutPlanSchema.parse(raw);
  const failureRate =
    plan.totalUpdates === 0 ? 0 : plan.failedUpdates / plan.totalUpdates;
  const blockers = [
    ...(!plan.evidenceCurrent ? ["Release evidence is stale or incomplete."] : []),
    ...(!plan.rollbackExercisesPassed ? ["Rollback exercise has not passed."] : []),
    ...(plan.criticalIncidents > 0 ? ["A critical incident is open."] : []),
    ...(plan.observedCanaryHours < plan.minimumCanaryHours
      ? ["Minimum canary observation has not elapsed."]
      : []),
    ...(failureRate > 0.02 ? ["Update failure rate exceeds the 2% promotion threshold."] : []),
  ];
  const nextStage =
    plan.stage === "draft"
      ? "canary"
      : plan.stage === "canary"
        ? "beta"
        : plan.stage === "beta"
          ? "stable"
          : null;
  return { allowed: blockers.length === 0 && nextStage !== null, blockers, nextStage };
}

export const releaseIncidentSchema = z.strictObject({
  schemaVersion: version,
  incidentId: z.string().regex(/^incident-[a-z0-9-]+$/),
  releaseId: z.string().regex(/^release-[a-z0-9.-]+$/),
  severity: z.enum(["low", "medium", "high", "critical"]),
  scope: z.enum(["artifact", "update", "compatibility", "data_integrity", "security"]),
  state: z.enum(["open", "contained", "monitoring", "resolved"]),
  summary: z.string().min(8).max(240),
  duplicateEffects: z.number().int().nonnegative(),
  dataIntegrityPreserved: z.boolean(),
  rollbackAvailable: z.boolean(),
});
export type ReleaseIncident = z.infer<typeof releaseIncidentSchema>;

export function incidentAction(raw: unknown): {
  readonly pauseRollout: boolean;
  readonly rollbackRecommended: boolean;
  readonly releaseBlocked: boolean;
  readonly action: string;
} {
  const incident = releaseIncidentSchema.parse(raw);
  const critical =
    incident.severity === "critical" ||
    !incident.dataIntegrityPreserved ||
    incident.duplicateEffects > 0;
  const rollbackRecommended =
    incident.rollbackAvailable &&
    (critical || incident.scope === "update" || incident.scope === "security");
  return {
    pauseRollout: incident.state !== "resolved",
    rollbackRecommended,
    releaseBlocked: critical || incident.state !== "resolved",
    action: rollbackRecommended
      ? "Pause promotion and restore the last compatible release."
      : "Pause promotion, contain the affected scope, and collect evidence.",
  };
}

export function buildReleaseNotes(input: {
  readonly version: string;
  readonly highlights: readonly string[];
  readonly migrations: readonly string[];
  readonly compatibilityChanges: readonly string[];
  readonly knownLimitations: readonly string[];
  readonly rollbackVersion: string;
}): string {
  semanticVersion.parse(input.version);
  semanticVersion.parse(input.rollbackVersion);
  return [
    `# Pipeline Studio ${input.version}`,
    section("Highlights", input.highlights),
    section("Migration", input.migrations),
    section("Compatibility", input.compatibilityChanges),
    section("Known limitations", input.knownLimitations),
    `## Rollback\n\nRestore version ${input.rollbackVersion} using the guided update recovery flow.`,
  ].join("\n\n");
}

function preservationFacts(plan: UpdatePlan): readonly string[] {
  return [
    ...(plan.projectCheckpointId ? [`Project checkpoint ${plan.projectCheckpointId}`] : []),
    ...(plan.databaseBackupId ? [`Database backup ${plan.databaseBackupId}`] : []),
    `Rollback source ${plan.rollbackVersion}`,
    "Credentials remain in the operating-system vault",
  ];
}

function section(title: string, values: readonly string[]): string {
  return `## ${title}\n\n${values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- None"}`;
}

function sha256(value: string): string {
  return `sha256:${browserSha256(value)}`;
}
