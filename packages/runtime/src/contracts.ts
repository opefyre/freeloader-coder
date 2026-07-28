import { z } from "zod";

export const supportedPlatformSchema = z.enum(["darwin", "linux", "win32"]);
export const supportedArchitectureSchema = z.enum(["arm64", "x64"]);

export const requirementDispositionSchema = z.enum([
  "required_now",
  "optional",
  "auto_repairable",
  "needs_user",
]);

export const requirementStateSchema = z.enum([
  "ready",
  "missing",
  "unsupported",
  "conflict",
]);

export const preflightSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  platform: supportedPlatformSchema,
  architecture: supportedArchitectureSchema,
  nodeMajor: z.number().int().nonnegative(),
  npmMajor: z.number().int().nonnegative(),
  gitAvailable: z.boolean(),
  totalMemoryGb: z.number().positive(),
  freeDiskGb: z.number().nonnegative(),
  stateDirectoryWritable: z.boolean(),
  preferredPort: z.number().int().min(1024).max(65_535),
  occupiedPorts: z.array(z.number().int().min(1).max(65_535)).max(256),
  activeController: z
    .strictObject({
      profileId: z.string().min(1).max(80),
      ownerId: z.string().uuid(),
      expiresAt: z.number().int().nonnegative(),
    })
    .nullable(),
  containerRuntimes: z.array(z.enum(["docker", "podman"])).max(2),
  localModelRuntimeAvailable: z.boolean(),
});

export const preflightRequirementSchema = z.strictObject({
  id: z.enum([
    "node",
    "npm",
    "git",
    "architecture",
    "memory",
    "disk",
    "state_directory",
    "loopback_port",
    "controller",
    "container",
    "local-model-runtime",
  ]),
  label: z.string().min(1).max(100),
  state: requirementStateSchema,
  disposition: requirementDispositionSchema,
  summary: z.string().min(1).max(240),
  action: z.string().min(1).max(300).nullable(),
  verification: z.string().min(1).max(240),
});

export const sandboxModeSchema = z.enum([
  "strong_container",
  "native_bounded",
  "remote_paired",
  "blocked",
]);

export const preflightReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(["ready", "needs_action", "unsupported"]),
  requirements: z.array(preflightRequirementSchema).min(1).max(20),
  selectedPort: z.number().int().min(1024).max(65_535).nullable(),
  selectedSandbox: sandboxModeSchema,
  resumeToken: z.string().regex(/^setup_[a-f0-9]{24}$/),
  generatedAt: z.number().int().nonnegative(),
});

export const setupStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  state: z.enum(["preflight", "needs_action", "ready", "running", "stopped"]),
  reportDigest: z.string().regex(/^[a-f0-9]{64}$/),
  selectedPort: z.number().int().min(1024).max(65_535).nullable(),
  selectedSandbox: sandboxModeSchema,
  credentialStore: z.literal("operating_system"),
  configuration: z.record(z.string(), z.string().max(500)),
  updatedAt: z.number().int().nonnegative(),
});

export const controllerLeaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  ownerId: z.string().uuid(),
  pid: z.number().int().positive(),
  loopbackHost: z.enum(["127.0.0.1", "::1"]),
  port: z.number().int().min(1024).max(65_535),
  acquiredAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

export const runtimeServiceSchema = z.strictObject({
  id: z.enum(["core", "worker", "validator", "preview", "local_model"]),
  state: z.enum(["stopped", "starting", "healthy", "draining", "interrupted"]),
  required: z.boolean(),
  restartCount: z.number().int().nonnegative(),
  lastCheckpointId: z.string().min(1).max(120).nullable(),
});

export const interruptedEffectSchema = z.strictObject({
  effectId: z.string().min(1).max(120),
  idempotencyKey: z.string().min(1).max(160),
  state: z.enum(["not_started", "attempted", "postcondition_verified"]),
  checkpointId: z.string().min(1).max(120),
});

export const repairPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(["safe_to_apply", "needs_user"]),
  summary: z.string().min(1).max(240),
  actions: z
    .array(
      z.strictObject({
        id: z.enum([
          "release_stale_lock",
          "select_free_port",
          "rebuild_projection",
          "restart_service",
          "preserve_interrupted_effect",
        ]),
        effect: z.string().min(1).max(220),
        preservesProjects: z.literal(true),
        preservesSecrets: z.literal(true),
      })
    )
    .max(10),
  blocker: z.string().min(1).max(300).nullable(),
  resumable: z.literal(true),
});

export type PreflightSnapshot = z.infer<typeof preflightSnapshotSchema>;
export type PreflightRequirement = z.infer<typeof preflightRequirementSchema>;
export type PreflightReport = z.infer<typeof preflightReportSchema>;
export type SetupState = z.infer<typeof setupStateSchema>;
export type SandboxMode = z.infer<typeof sandboxModeSchema>;
export type ControllerLease = z.infer<typeof controllerLeaseSchema>;
export type RuntimeService = z.infer<typeof runtimeServiceSchema>;
export type InterruptedEffect = z.infer<typeof interruptedEffectSchema>;
export type RepairPlan = z.infer<typeof repairPlanSchema>;
