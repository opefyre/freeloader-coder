import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const id = z.string().trim().min(1).max(160);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const relativePath = z.string().trim().min(1).max(500).refine(
  (value) =>
    !value.startsWith("/")
    && !value.startsWith("\\")
    && !value.split(/[\\/]/).includes("..")
    && !/^[a-zA-Z]:/.test(value),
  "Path must be project-relative."
);

export const isolationModeSchema = z.enum([
  "strong_container",
  "native_constrained",
  "remote_worker"
]);

export const executionCapabilitySchema = z.enum([
  "filesystem_read",
  "filesystem_write",
  "process_spawn",
  "network_allowlist",
  "network_unrestricted",
  "secret_reference",
  "preview",
  "screenshot",
  "host_mount",
  "local_model"
]);

export const isolationProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  label: text,
  mode: isolationModeSchema,
  strengthLabel: z.enum(["Strong isolation", "Reduced isolation", "Remote isolation"]),
  capabilities: z.array(executionCapabilitySchema).min(1),
  limits: z.strictObject({
    cpuPercent: z.number().int().min(5).max(100),
    memoryMb: z.number().int().min(256).max(65_536),
    diskMb: z.number().int().min(128).max(1_000_000),
    processCount: z.number().int().min(1).max(1_024),
    timeoutMs: z.number().int().min(1_000).max(86_400_000),
    network: z.enum(["none", "allowlist", "unrestricted"])
  }),
  secretReferences: z.array(z.string().regex(/^vault:[a-z0-9._-]+$/)).max(50)
}).superRefine((value, context) => {
  if (
    value.mode === "native_constrained"
    && value.capabilities.some((capability) =>
      ["network_unrestricted", "secret_reference", "host_mount"].includes(capability)
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Reduced isolation cannot use strong-isolation capabilities."
    });
  }
  if (
    value.limits.network === "unrestricted"
    && !value.capabilities.includes("network_unrestricted")
  ) {
    context.addIssue({
      code: "custom",
      message: "Unrestricted network requires the matching capability."
    });
  }
});

export const isolatedWorkspaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  taskId: id,
  runId: id,
  workspaceRef: z.string().regex(/^workspace:[a-f0-9]{16}$/),
  branch: z.string().regex(/^studio\/[a-z0-9-]+-[a-f0-9]{10}$/),
  baseline: z.string().regex(/^[a-f0-9]{7,64}$/),
  profileId: id,
  state: z.enum(["active", "paused", "abandoned", "recoverable", "cleanup_ready", "cleaned"]),
  ancestryVerified: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  recoverUntil: z.number().int().positive().nullable(),
  stateDigest: digest
});

export const toolKindSchema = z.enum([
  "read",
  "search",
  "patch",
  "format",
  "command",
  "git",
  "screenshot",
  "preview",
  "artifact",
  "checkpoint"
]);

export const toolEffectSchema = z.enum([
  "read_project",
  "write_project",
  "run_process",
  "read_network",
  "write_git",
  "start_preview",
  "create_artifact",
  "create_checkpoint"
]);

export const toolInvocationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  tool: toolKindSchema,
  projectId: id,
  paths: z.array(relativePath).max(500),
  commandId: id.nullable(),
  environmentReferences: z.array(z.string().regex(/^vault:[a-z0-9._-]+$/)).max(50),
  networkHosts: z.array(z.hostname()).max(50),
  declaredEffects: z.array(toolEffectSchema).min(1),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
  maxOutputBytes: z.number().int().min(256).max(10_000_000),
  idempotencyKey: id
});

export const toolReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  invocationId: id,
  tool: toolKindSchema,
  inputDigest: digest,
  outputSummary: text,
  outputExcerpt: z.string().max(10_000),
  artifactRef: z.string().regex(/^artifact:[a-f0-9]{16}$/).nullable(),
  exitStatus: z.enum(["succeeded", "failed", "timed_out", "denied"]),
  durationMs: z.number().nonnegative(),
  observedEffects: z.array(toolEffectSchema),
  redactions: z.number().int().nonnegative()
});

export const executionCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  kind: z.enum(["baseline", "task", "validation", "accepted", "published"]),
  sourceDigest: digest,
  affectedFeatures: z.array(text).max(100),
  files: z.array(relativePath).max(2_000),
  generatedData: z.array(relativePath).max(500),
  conflicts: z.array(z.strictObject({
    path: relativePath,
    currentDigest: digest,
    proposedDigest: digest,
    currentLabel: text,
    proposedLabel: text
  })).max(500),
  restoreImpact: text,
  createdAt: z.number().int().nonnegative()
});

export const checkpointDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  checkpointId: id,
  action: z.enum(["keep", "restore", "publish"]),
  actorId: id,
  reversible: z.boolean(),
  compensation: text,
  decidedAt: z.number().int().nonnegative(),
  evidenceDigest: digest
});

export const resourceSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  memoryMb: z.number().int().positive(),
  availableMemoryMb: z.number().int().nonnegative(),
  freeDiskMb: z.number().int().nonnegative(),
  batteryPercent: z.number().int().min(0).max(100).nullable(),
  charging: z.boolean().nullable(),
  thermal: z.enum(["nominal", "fair", "serious", "critical"]),
  sleeping: z.boolean(),
  concurrentWorkloads: z.number().int().nonnegative(),
  localModels: z.array(text).max(100),
  runtimes: z.array(text).max(100)
});

export const computeProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.enum(["lightweight", "standard", "distributed"]),
  label: text,
  maxConcurrency: z.number().int().min(1).max(16),
  workerMemoryMb: z.number().int().min(512).max(32_768),
  cpuPercent: z.number().int().min(10).max(100),
  localModelsAllowed: z.boolean(),
  minFreeDiskMb: z.number().int().min(1_024),
  batteryFloorPercent: z.number().int().min(5).max(100)
});

export type IsolationProfile = z.infer<typeof isolationProfileSchema>;
export type IsolatedWorkspace = z.infer<typeof isolatedWorkspaceSchema>;
export type ToolKind = z.infer<typeof toolKindSchema>;
export type ToolEffect = z.infer<typeof toolEffectSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
export type ToolReceipt = z.infer<typeof toolReceiptSchema>;
export type ExecutionCheckpoint = z.infer<typeof executionCheckpointSchema>;
export type CheckpointDecision = z.infer<typeof checkpointDecisionSchema>;
export type ResourceSnapshot = z.infer<typeof resourceSnapshotSchema>;
export type ComputeProfile = z.infer<typeof computeProfileSchema>;
