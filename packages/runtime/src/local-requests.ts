import { z } from "zod";

const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const boundedOutcome = z.string().trim().min(3).max(20_000);
const relativePath = z.string().trim().min(1).max(240).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]/).includes(".."),
  "Path must be project-relative."
);

export const localRequestCreationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  outcome: boundedOutcome,
});

export const localReadinessFindingSchema = z.strictObject({
  code: z.enum(["outcome_required", "sensitive_material", "implementation_assumption"]),
  severity: z.enum(["blocking", "assumption"]),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(500),
});

export const localWorkPreviewSchema = z.strictObject({
  provenance: z.literal("deterministic_local_preview"),
  title: z.string().trim().min(1).max(160),
  outcome: boundedOutcome,
  assumptions: z.array(z.string().trim().min(1).max(500)).max(10),
  exclusions: z.array(z.string().trim().min(1).max(500)).max(10),
  checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
  estimatedMinutes: z.number().int().min(1).max(480),
});

export const localExecutionContractSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^contract_[a-f0-9]{20}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  requestId,
  projectId,
  outcome: boundedOutcome,
  policy: z.literal("zero_effect"),
  allowedEffects: z.tuple([]),
  maximumCostUsd: z.literal(0),
  checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
  approvedAt: z.number().int().nonnegative(),
});

export const localRunEventSchema = z.strictObject({
  sequence: z.number().int().positive(),
  type: z.enum([
    "contract_approved",
    "lease_claimed",
    "checkpoint_observed",
    "lease_released",
    "lease_expired",
    "grounding_created",
    "plan_updated",
    "plan_approved",
    "execution_authorized",
    "workspace_preparing",
    "workspace_ready",
    "execution_cancelled",
    "execution_reconciled",
    "execution_started",
    "validation_started",
    "validation_completed",
    "validation_failed",
    "patch_previewed",
    "patch_approved",
    "patch_applying",
    "patch_applied",
    "patch_rolled_back",
    "patch_reconciled",
    "commit_previewed",
    "commit_approved",
    "commit_creating",
    "commit_created",
    "commit_undone",
    "commit_reconciled",
    "integration_previewed",
    "integration_approved",
    "integration_creating",
    "integration_created",
    "integration_undone",
    "integration_reconciled",
  ]),
  observedAt: z.number().int().nonnegative(),
  detail: z.string().trim().min(1).max(300),
});

export const localGroundingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  provenance: z.literal("bounded_local_files"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().nonnegative(),
  sources: z.array(z.strictObject({
    path: relativePath,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative().max(65_536),
    classification: z.enum(["guidance", "manifest", "documentation"]),
    excerpt: z.string().max(2_000),
  })).min(1).max(12),
  limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export const localTopologySchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  provenance: z.literal("bounded_path_inventory"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().nonnegative(),
  entries: z.array(z.strictObject({
    path: relativePath,
    kind: z.enum(["source", "test", "config", "documentation", "asset", "other"]),
    extension: z.string().regex(/^\.[a-zA-Z0-9]{1,12}$/).nullable(),
    bytes: z.number().int().nonnegative().max(2_000_000),
  })).min(1).max(800),
  truncated: z.boolean(),
  excludedDirectories: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export const localDraftPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("deterministic_local_plan"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  groundingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  topologyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive().max(100),
  state: z.enum(["draft", "approved"]),
  order: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).min(1).max(8),
  approval: z.strictObject({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().positive().max(100),
    approvedAt: z.number().int().nonnegative(),
    policy: z.literal("zero_effect"),
    executionAuthorized: z.literal(false),
  }).nullable(),
  tasks: z.array(z.strictObject({
    id: z.string().regex(/^task_[a-f0-9]{12}$/),
    title: z.string().trim().min(1).max(160),
    outcome: boundedOutcome,
    scope: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    allowedFiles: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    citedSources: z.array(relativePath).min(1).max(12),
    dependsOn: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).max(7),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    exclusions: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
    risk: z.enum(["low", "medium", "high"]),
    estimatedMinutes: z.number().int().min(5).max(480),
  })).min(1).max(8),
});

export const localPlanEditSchema = z.discriminatedUnion("type", [
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal("edit_task"),
    expectedRevision: z.number().int().positive().max(100),
    taskId: z.string().regex(/^task_[a-f0-9]{12}$/),
    title: z.string().trim().min(1).max(160),
    estimatedMinutes: z.number().int().min(5).max(480),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal("reorder"),
    expectedRevision: z.number().int().positive().max(100),
    order: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).min(1).max(8),
  }),
]);

export const localPlanApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().positive().max(100),
});

export const localExecutionAuthorizationRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedPlanRevision: z.number().int().positive().max(100),
  expectedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  isolationProfile: z.literal("native_bounded_worktree"),
});

export const localRepositoryPreflightSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("bounded_git_observation"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().nonnegative(),
  baseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  branch: z.string().trim().min(1).max(200).nullable(),
  clean: z.literal(true),
  repositoryRootMatched: z.literal(true),
  gitAvailable: z.literal(true),
  limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export const localExecutionManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  baseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  order: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).min(1).max(8),
  tasks: z.array(z.strictObject({
    id: z.string().regex(/^task_[a-f0-9]{12}$/),
    title: z.string().trim().min(1).max(160),
    allowedFiles: z.array(relativePath).min(1).max(12),
    dependsOn: z.array(z.string().regex(/^task_[a-f0-9]{12}$/)).max(7),
    checks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
  })).min(1).max(8),
  allowedEffects: z.tuple([z.literal("create_isolated_worktree")]),
  excludedEffects: z.tuple([
    z.literal("canonical_worktree_write"),
    z.literal("network"),
    z.literal("provider"),
    z.literal("credential"),
    z.literal("paid_usage"),
    z.literal("publish"),
    z.literal("deploy"),
  ]),
  maximumCostUsd: z.literal(0),
});

export const localExecutionAuthoritySchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^authority_[a-f0-9]{20}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  requestId,
  projectId,
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  planRevision: z.number().int().positive().max(100),
  planApprovalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  groundingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  topologyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  preflight: localRepositoryPreflightSchema,
  manifest: localExecutionManifestSchema,
  isolationProfile: z.literal("native_bounded_worktree"),
  maximumCostUsd: z.literal(0),
  authorizedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export const localExecutionWorkspaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceRef: z.string().regex(/^workspace_[a-f0-9]{20}$/),
  branch: z.string().regex(/^studio\/request-[a-f0-9]{12}-[a-f0-9]{10}$/),
  baseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  state: z.enum(["ready", "preserved", "interrupted"]),
  createdAt: z.number().int().nonnegative(),
  stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const localValidationAttemptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^attempt_[a-f0-9]{20}$/),
  command: z.strictObject({
    executable: z.literal("git"),
    arguments: z.tuple([z.literal("diff"), z.literal("--check")]),
    timeoutMs: z.literal(10_000),
    maximumOutputBytes: z.literal(65_536),
  }),
  state: z.enum(["passed", "failed", "timed_out", "cancelled", "policy_denied"]),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative(),
  exitCode: z.number().int().min(0).max(255).nullable(),
  output: z.string().max(65_536),
  outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  truncated: z.boolean(),
});

export const localChangeObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("bounded_git_change_observation"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().nonnegative(),
  changedPaths: z.array(z.strictObject({
    path: relativePath,
    state: z.enum(["added", "modified", "deleted", "renamed", "untracked"]),
  })).max(200),
  canonicalBaseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  workspaceBaseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  canonicalClean: z.literal(true),
  allowed: z.boolean(),
  blockers: z.array(z.string().trim().min(1).max(300)).max(50),
  limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export const localExecutionRunSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^execution_[a-f0-9]{20}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["ready", "validating", "passed", "failed", "cancelled", "interrupted"]),
  authorityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceRef: z.string().regex(/^workspace_[a-f0-9]{20}$/),
  baseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  maximumCostUsd: z.literal(0),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  attempts: z.array(localValidationAttemptSchema).max(20),
  changes: localChangeObservationSchema.nullable(),
});

export const localPatchPreviewRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedAuthorityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRunDigest: z.string().regex(/^[a-f0-9]{64}$/),
  path: relativePath,
  expectedBeforeDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  replacementContent: z.string().max(65_536).refine(
    (value) => !value.includes("\0"),
    "Replacement must be UTF-8 text without NUL bytes."
  ),
});

export const localPatchPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("bounded_local_replacement_preview"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  authorityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  runDigest: z.string().regex(/^[a-f0-9]{64}$/),
  path: relativePath,
  beforeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  afterDigest: z.string().regex(/^[a-f0-9]{64}$/),
  beforeBytes: z.number().int().nonnegative().max(65_536),
  afterBytes: z.number().int().nonnegative().max(65_536),
  beforeLines: z.number().int().nonnegative().max(20_000),
  afterLines: z.number().int().nonnegative().max(20_000),
  replacementContent: z.string().max(65_536),
  previewedAt: z.number().int().nonnegative(),
  blockers: z.tuple([]),
  maximumCostUsd: z.literal(0),
});

export const localPatchApprovalRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedPreviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const localPatchApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.number().int().nonnegative(),
});

export const localPatchReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  path: relativePath,
  beforeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  afterDigest: z.string().regex(/^[a-f0-9]{64}$/),
  observedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  appliedAt: z.number().int().nonnegative(),
  canonicalUntouched: z.literal(true),
});

export const localPatchSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(["previewed", "approved", "applying", "applied", "rolled_back", "interrupted"]),
  preview: localPatchPreviewSchema,
  approval: localPatchApprovalSchema.nullable(),
  receipt: localPatchReceiptSchema.nullable(),
  rolledBackAt: z.number().int().nonnegative().nullable(),
});

export const localCommitPreviewRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedAuthorityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRunDigest: z.string().regex(/^[a-f0-9]{64}$/),
  message: z.string().trim().min(3).max(200).refine(
    (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    "Commit message contains unsupported control characters."
  ),
});

export const localCommitPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("bounded_isolated_commit_preview"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  authorityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  runDigest: z.string().regex(/^[a-f0-9]{64}$/),
  patchReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  parentCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
  branch: z.string().regex(/^studio\/request-[a-f0-9]{12}-[a-f0-9]{10}$/),
  message: z.string().trim().min(3).max(200),
  messageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  changedPaths: z.array(relativePath).min(1).max(12),
  insertions: z.number().int().nonnegative().max(100_000),
  deletions: z.number().int().nonnegative().max(100_000),
  hooksDisabled: z.literal(true),
  signingDisabled: z.literal(true),
  identity: z.literal("Pipeline Studio <pipeline-studio@local.invalid>"),
  maximumCostUsd: z.literal(0),
  previewedAt: z.number().int().nonnegative(),
});

export const localCommitApprovalRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedPreviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const localCommitApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.number().int().nonnegative(),
});

export const localCommitReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  parentCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
  branch: z.string().regex(/^studio\/request-[a-f0-9]{12}-[a-f0-9]{10}$/),
  changedPaths: z.array(relativePath).min(1).max(12),
  createdAt: z.number().int().nonnegative(),
  canonicalUntouched: z.literal(true),
  hooksDisabled: z.literal(true),
  signingDisabled: z.literal(true),
  pushed: z.literal(false),
});

export const localCommitSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(["previewed", "approved", "creating", "created", "undone", "interrupted"]),
  preview: localCommitPreviewSchema,
  approval: localCommitApprovalSchema.nullable(),
  receipt: localCommitReceiptSchema.nullable(),
  undoneAt: z.number().int().nonnegative().nullable(),
});

export const localIntegrationPreviewRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedCommitReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const localIntegrationPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("bounded_local_integration_preview"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  commitReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
  sourceParent: z.string().regex(/^[a-f0-9]{40,64}$/),
  targetBranch: z.string().trim().min(1).max(200),
  targetHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  changedPaths: z.array(relativePath).min(1).max(12),
  strategy: z.literal("cherry_pick_one_commit"),
  conflictProbe: z.literal("passed"),
  hooksDisabled: z.literal(true),
  signingDisabled: z.literal(true),
  pushed: z.literal(false),
  maximumCostUsd: z.literal(0),
  previewedAt: z.number().int().nonnegative(),
});

export const localIntegrationApprovalRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedPreviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const localIntegrationApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.number().int().nonnegative(),
});

export const localIntegrationReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
  previousHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  resultingHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  targetBranch: z.string().trim().min(1).max(200),
  changedPaths: z.array(relativePath).min(1).max(12),
  createdAt: z.number().int().nonnegative(),
  hooksDisabled: z.literal(true),
  signingDisabled: z.literal(true),
  pushed: z.literal(false),
});

export const localIntegrationSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(["previewed", "approved", "creating", "created", "undone", "interrupted"]),
  preview: localIntegrationPreviewSchema,
  approval: localIntegrationApprovalSchema.nullable(),
  receipt: localIntegrationReceiptSchema.nullable(),
  undoneAt: z.number().int().nonnegative().nullable(),
});

export const localExecutionSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum([
    "authorized",
    "preparing",
    "ready",
    "validating",
    "validated",
    "review_ready",
    "failed",
    "cancelled",
    "interrupted",
    "blocked",
  ]),
  authority: localExecutionAuthoritySchema,
  workspace: localExecutionWorkspaceSchema.nullable(),
  run: localExecutionRunSchema.nullable().default(null),
  patch: localPatchSessionSchema.nullable().default(null),
  commit: localCommitSessionSchema.nullable().default(null),
  integration: localIntegrationSessionSchema.nullable().default(null),
});

export const localPlanningSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  grounding: localGroundingSchema,
  topology: localTopologySchema,
});

export const localRunSchema = z.strictObject({
  state: z.enum(["approved", "claimed", "checkpointed", "completed", "interrupted"]),
  contract: localExecutionContractSchema,
  lease: z.strictObject({
    id: z.string().regex(/^lease_[a-f0-9]{20}$/),
    owner: z.literal("local_zero_effect_coordinator"),
    expiresAt: z.number().int().nonnegative(),
  }).nullable(),
  events: z.array(localRunEventSchema).max(100),
});

export const localRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: requestId,
  projectId,
  outcome: boundedOutcome,
  readiness: z.enum(["ready", "needs_input"]),
  state: z.enum([
    "queued",
    "needs_input",
    "approved",
    "claimed",
    "checkpointed",
    "completed",
    "interrupted",
    "cancelled",
  ]),
  provenance: z.literal("local_request"),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  findings: z.array(localReadinessFindingSchema).max(20),
  workPreview: localWorkPreviewSchema.nullable(),
  run: localRunSchema.nullable(),
  grounding: localGroundingSchema.optional(),
  topology: localTopologySchema.optional(),
  plan: localDraftPlanSchema.optional(),
  execution: localExecutionSessionSchema.optional(),
});

export const localRequestCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_observation"),
  observedAt: z.number().int().nonnegative(),
  requests: z.array(localRequestSchema).max(500),
});

export const localRequestMutationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum([
    "created",
    "approved",
    "claimed",
    "checkpointed",
    "released",
    "reconciled",
    "grounded",
    "plan_updated",
    "plan_approved",
    "execution_authorized",
    "workspace_prepared",
    "execution_cancelled",
    "execution_reconciled",
    "execution_started",
    "execution_validated",
    "patch_previewed",
    "patch_approved",
    "patch_applied",
    "patch_rolled_back",
    "patch_reconciled",
    "commit_previewed",
    "commit_approved",
    "commit_created",
    "commit_undone",
    "commit_reconciled",
    "integration_previewed",
    "integration_approved",
    "integration_created",
    "integration_undone",
    "integration_reconciled",
    "cancelled",
    "archived",
  ]),
  request: localRequestSchema.nullable(),
});

export type LocalRequestCreation = z.infer<typeof localRequestCreationSchema>;
export type LocalRequest = z.infer<typeof localRequestSchema>;
export type LocalRequestCollection = z.infer<typeof localRequestCollectionSchema>;
export type LocalRequestMutationResponse = z.infer<typeof localRequestMutationResponseSchema>;
export type LocalGrounding = z.infer<typeof localGroundingSchema>;
export type LocalTopology = z.infer<typeof localTopologySchema>;
export type LocalDraftPlan = z.infer<typeof localDraftPlanSchema>;
export type LocalPlanEdit = z.infer<typeof localPlanEditSchema>;
export type LocalPlanningSnapshot = z.infer<typeof localPlanningSnapshotSchema>;
export type LocalExecutionAuthorizationRequest = z.infer<
  typeof localExecutionAuthorizationRequestSchema
>;
export type LocalRepositoryPreflight = z.infer<typeof localRepositoryPreflightSchema>;
export type LocalExecutionManifest = z.infer<typeof localExecutionManifestSchema>;
export type LocalExecutionAuthority = z.infer<typeof localExecutionAuthoritySchema>;
export type LocalExecutionWorkspace = z.infer<typeof localExecutionWorkspaceSchema>;
export type LocalExecutionSession = z.infer<typeof localExecutionSessionSchema>;
export type LocalExecutionRun = z.infer<typeof localExecutionRunSchema>;
export type LocalValidationAttempt = z.infer<typeof localValidationAttemptSchema>;
export type LocalChangeObservation = z.infer<typeof localChangeObservationSchema>;
export type LocalPatchPreviewRequest = z.infer<typeof localPatchPreviewRequestSchema>;
export type LocalPatchPreview = z.infer<typeof localPatchPreviewSchema>;
export type LocalPatchApproval = z.infer<typeof localPatchApprovalSchema>;
export type LocalPatchReceipt = z.infer<typeof localPatchReceiptSchema>;
export type LocalPatchSession = z.infer<typeof localPatchSessionSchema>;
export type LocalCommitPreview = z.infer<typeof localCommitPreviewSchema>;
export type LocalCommitApproval = z.infer<typeof localCommitApprovalSchema>;
export type LocalCommitReceipt = z.infer<typeof localCommitReceiptSchema>;
export type LocalCommitSession = z.infer<typeof localCommitSessionSchema>;
export type LocalIntegrationPreview = z.infer<typeof localIntegrationPreviewSchema>;
export type LocalIntegrationApproval = z.infer<typeof localIntegrationApprovalSchema>;
export type LocalIntegrationReceipt = z.infer<typeof localIntegrationReceiptSchema>;
export type LocalIntegrationSession = z.infer<typeof localIntegrationSessionSchema>;

export function validateLocalRequestCollection(input: unknown): LocalRequestCollection {
  const collection = localRequestCollectionSchema.parse(input);
  const identities = collection.requests.map((request) => request.id);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Local request collection contains duplicate identities.");
  }
  for (const request of collection.requests) {
    if (request.plan || request.grounding || request.topology) {
      if (
        !request.plan ||
        !request.grounding ||
        !request.topology ||
        request.grounding.projectId !== request.projectId ||
        request.topology.projectId !== request.projectId ||
        request.plan.groundingDigest !== request.grounding.digest ||
        request.plan.topologyDigest !== request.topology.digest
      ) {
        throw new Error("Local plan does not match its grounding snapshot.");
      }
      validatePlan(request.plan, request.grounding, request.topology);
    }
    if (request.run) {
      if (
        request.run.contract.requestId !== request.id ||
        request.run.contract.projectId !== request.projectId ||
        request.run.contract.outcome !== request.outcome ||
        request.run.state !== request.state
      ) {
        throw new Error("Local run does not match its immutable request contract.");
      }
      request.run.events.forEach((event, index) => {
        if (event.sequence !== index + 1) {
          throw new Error("Local run event sequence is not contiguous.");
        }
      });
    } else if (
      ["approved", "claimed", "checkpointed", "completed", "interrupted"].includes(
        request.state
      )
    ) {
      throw new Error("Local run state requires an execution contract.");
    }
    if (request.execution) {
      const execution = request.execution;
      if (
        !request.plan ||
        request.plan.state !== "approved" ||
        !request.plan.approval ||
        execution.authority.requestId !== request.id ||
        execution.authority.projectId !== request.projectId ||
        execution.authority.planDigest !== request.plan.digest ||
        execution.authority.planRevision !== request.plan.revision ||
        execution.authority.planApprovalDigest !== request.plan.approval.digest ||
        execution.authority.groundingDigest !== request.grounding?.digest ||
        execution.authority.topologyDigest !== request.topology?.digest ||
        execution.authority.manifest.planDigest !== request.plan.digest ||
        execution.authority.manifest.baseline !== execution.authority.preflight.baseline ||
        execution.authority.maximumCostUsd !== 0
      ) {
        throw new Error("Local execution authority does not match the approved plan.");
      }
      if (
        (["ready", "validating", "validated", "review_ready", "failed"].includes(
          execution.state
        ) &&
          execution.workspace?.state !== "ready") ||
        (execution.state === "cancelled" &&
          execution.workspace !== null &&
          execution.workspace.state !== "preserved") ||
        (execution.state === "interrupted" &&
          execution.workspace !== null &&
          execution.workspace.state !== "interrupted")
      ) {
        throw new Error("Local execution workspace does not match its session state.");
      }
      if (execution.run) {
        if (
          !execution.workspace ||
          execution.run.authorityDigest !== execution.authority.digest ||
          execution.run.manifestDigest !== execution.authority.manifest.digest ||
          execution.run.workspaceRef !== execution.workspace.workspaceRef ||
          execution.run.baseline !== execution.workspace.baseline ||
          execution.run.maximumCostUsd !== 0 ||
          new Set(execution.run.attempts.map((attempt) => attempt.id)).size !==
            execution.run.attempts.length
        ) {
          throw new Error("Local execution run does not match its authority or workspace.");
        }
        if (
          execution.state === "review_ready" &&
          (execution.run.state !== "passed" ||
            !execution.run.changes?.allowed ||
            execution.run.changes.changedPaths.length === 0)
        ) {
          throw new Error("Review-ready execution requires passed validation and observed changes.");
        }
      } else if (
        ["validating", "validated", "review_ready", "failed"].includes(execution.state)
      ) {
        throw new Error("Local execution state requires a bounded run.");
      }
      if (execution.patch) {
        const patch = execution.patch;
        if (
          !execution.run ||
          patch.preview.authorityDigest !== execution.authority.digest ||
          patch.preview.runDigest !== execution.run.digest ||
          patch.preview.maximumCostUsd !== 0 ||
          patch.preview.blockers.length !== 0
        ) {
          throw new Error("Local patch preview does not match the bounded execution run.");
        }
        if (
          ["approved", "applying", "applied", "rolled_back", "interrupted"].includes(
            patch.state
          ) &&
          (!patch.approval || patch.approval.previewDigest !== patch.preview.digest)
        ) {
          throw new Error("Local patch state requires approval of the exact preview.");
        }
        if (
          ["applied", "rolled_back"].includes(patch.state) &&
          (!patch.receipt ||
            patch.receipt.previewDigest !== patch.preview.digest ||
            patch.receipt.path !== patch.preview.path ||
            patch.receipt.beforeDigest !== patch.preview.beforeDigest ||
            patch.receipt.afterDigest !== patch.preview.afterDigest ||
            patch.receipt.observedDigest !== patch.preview.afterDigest)
        ) {
          throw new Error("Local patch receipt does not match its exact preview.");
        }
        if (patch.state === "rolled_back" && patch.rolledBackAt === null) {
          throw new Error("Rolled-back patch requires a verified rollback time.");
        }
      }
      if (execution.commit) {
        const commit = execution.commit;
        if (
          !execution.run ||
          !execution.patch?.receipt ||
          commit.preview.authorityDigest !== execution.authority.digest ||
          commit.preview.runDigest !== execution.run.digest ||
          commit.preview.patchReceiptDigest !== execution.patch.receipt.digest ||
          commit.preview.parentCommit !== execution.workspace?.baseline ||
          commit.preview.maximumCostUsd !== 0 ||
          !commit.preview.hooksDisabled ||
          !commit.preview.signingDisabled
        ) {
          throw new Error("Local commit preview does not match validated execution evidence.");
        }
        if (
          ["approved", "creating", "created", "undone", "interrupted"].includes(commit.state) &&
          (!commit.approval || commit.approval.previewDigest !== commit.preview.digest)
        ) {
          throw new Error("Local commit state requires approval of the exact preview.");
        }
        if (
          ["created", "undone"].includes(commit.state) &&
          (!commit.receipt ||
            commit.receipt.previewDigest !== commit.preview.digest ||
            commit.receipt.parentCommit !== commit.preview.parentCommit ||
            commit.receipt.branch !== commit.preview.branch ||
            commit.receipt.changedPaths.join("\0") !==
              commit.preview.changedPaths.join("\0") ||
            commit.receipt.pushed)
        ) {
          throw new Error("Local commit receipt does not match its preview.");
        }
        if (commit.state === "undone" && commit.undoneAt === null) {
          throw new Error("Undone commit requires a verified undo time.");
        }
      }
    }
  }
  return collection;
}

function validatePlan(
  plan: LocalDraftPlan,
  grounding: LocalGrounding,
  topology: LocalTopology
): void {
  const ids = plan.tasks.map((task) => task.id);
  if (
    new Set(ids).size !== ids.length ||
    plan.order.length !== ids.length ||
    new Set(plan.order).size !== ids.length ||
    plan.order.some((id) => !ids.includes(id))
  ) {
    throw new Error("Local plan task identities or order are invalid.");
  }
  const positions = new Map(plan.order.map((id, index) => [id, index]));
  const sourcePaths = new Set(grounding.sources.map((source) => source.path));
  const topologyPaths = new Set(topology.entries.map((entry) => entry.path));
  const fileOwner = new Map<string, string>();
  for (const task of plan.tasks) {
    if (
      task.citedSources.some((path) => !sourcePaths.has(path)) ||
      task.allowedFiles.some((path) => !topologyPaths.has(path)) ||
      task.dependsOn.some((id) => !ids.includes(id) || id === task.id)
    ) {
      throw new Error("Local plan contains an ungrounded source, target, or dependency.");
    }
    for (const dependency of task.dependsOn) {
      if ((positions.get(dependency) ?? Infinity) >= (positions.get(task.id) ?? -1)) {
        throw new Error("Local plan dependency order is invalid.");
      }
    }
    for (const path of task.allowedFiles) {
      const owner = fileOwner.get(path);
      if (
        owner &&
        !task.dependsOn.includes(owner) &&
        !plan.tasks.find((candidate) => candidate.id === owner)?.dependsOn.includes(task.id)
      ) {
        throw new Error("Local plan contains unordered overlapping file scope.");
      }
      fileOwner.set(path, task.id);
    }
  }
  if (
    (plan.state === "approved") !== Boolean(plan.approval) ||
    (plan.approval && plan.approval.revision !== plan.revision)
  ) {
    throw new Error("Local plan approval does not match its immutable revision.");
  }
}
