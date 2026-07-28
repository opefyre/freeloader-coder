import { z } from "zod";

const boundedText = z.string().trim().min(1).max(500);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const relativePath = z.string().trim().min(1).max(500).refine(
  (value) =>
    !value.startsWith("/")
    && !value.startsWith("\\")
    && !value.split(/[\\/]/).includes("..")
    && !/^[a-zA-Z]:/.test(value),
  "Path must be project-relative."
);

export const projectEntryRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("local"),
    path: boundedText
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("github_clone"),
    url: z.url(),
    destination: boundedText
  })
]);

export const gitInspectionSchema = z.strictObject({
  present: z.boolean(),
  branch: boundedText.nullable(),
  head: z.string().regex(/^[a-f0-9]{7,64}$/).nullable(),
  detached: z.boolean(),
  dirtyPaths: z.array(relativePath).max(2_000),
  untrackedPaths: z.array(relativePath).max(2_000),
  ignoredSensitivePaths: z.array(relativePath).max(500),
  largeFiles: z.array(z.strictObject({
    path: relativePath,
    bytes: z.number().int().positive()
  })).max(500),
  nestedRepositories: z.array(relativePath).max(100),
  remotes: z.array(z.strictObject({
    name: boundedText,
    host: boundedText
  })).max(20)
}).superRefine((value, context) => {
  if (!value.present && (value.branch !== null || value.head !== null || value.detached)) {
    context.addIssue({
      code: "custom",
      message: "A non-Git project cannot declare branch, head, or detached state."
    });
  }
  if (value.present && value.head === null) {
    context.addIssue({
      code: "custom",
      message: "An existing Git project requires an observed head."
    });
  }
});

export const repositoryInspectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repositoryId: z.string().trim().min(1).max(160),
  canonicalPath: boundedText,
  displayName: z.string().trim().min(1).max(160),
  exists: z.boolean(),
  directory: z.boolean(),
  destinationState: z.enum(["unused", "empty", "occupied"]),
  authentication: z.enum(["not_required", "ready", "required", "denied"]),
  sizeBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  submodules: z.array(relativePath).max(200),
  lfs: z.boolean(),
  unsupportedReasons: z.array(boundedText).max(20),
  detectedCommands: z.array(boundedText).max(50),
  risks: z.array(boundedText).max(50),
  missingDependencies: z.array(boundedText).max(50),
  git: gitInspectionSchema
});

export const canonicalProjectRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1).max(160),
  repositoryId: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(160),
  repositoryRefDigest: digest,
  state: z.enum(["ready", "needs_setup", "unsupported"]),
  summary: z.strictObject({
    sizeBytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    hasGit: z.boolean(),
    hasSubmodules: z.boolean(),
    usesLfs: z.boolean(),
    detectedCommands: z.array(boundedText).max(50),
    risks: z.array(boundedText).max(50),
    missingDependencies: z.array(boundedText).max(50)
  }),
  recommendedFirstAction: boundedText
});

export const projectFileSchema = z.strictObject({
  path: relativePath,
  content: z.string().max(2_000_000),
  bytes: z.number().int().nonnegative()
});

export const groundingStatementSchema = z.strictObject({
  classification: z.enum(["fact", "inference", "assumption", "user_decision"]),
  text: boundedText,
  citations: z.array(relativePath).max(20)
});

export const projectProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().trim().min(1).max(160),
  sourceDigest: digest,
  groundingDigest: digest,
  languages: z.array(boundedText).max(30),
  frameworks: z.array(boundedText).max(30),
  packageManagers: z.array(boundedText).max(10),
  commands: z.array(z.strictObject({
    name: boundedText,
    command: boundedText,
    citation: relativePath
  })).max(100),
  ports: z.array(z.number().int().min(1).max(65_535)).max(50),
  conventions: z.array(boundedText).max(50),
  designTokens: z.array(boundedText).max(100),
  protectedPaths: z.array(relativePath).max(500),
  tests: z.array(relativePath).max(500),
  readiness: z.enum(["ready", "partial", "blocked", "unsupported"]),
  unsupportedFeatures: z.array(boundedText).max(50),
  missingDependencies: z.array(boundedText).max(50),
  resourceRequirements: z.array(boundedText).max(50),
  citations: z.array(z.strictObject({
    path: relativePath,
    sha256: digest
  })).max(2_000),
  statements: z.array(groundingStatementSchema).min(1).max(500)
});

export const checkpointPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["existing_git", "initialize_git"]),
  baseline: z.string().regex(/^[a-f0-9]{7,64}$/).nullable(),
  branch: boundedText,
  userWorkOutsideCheckpoint: z.array(relativePath).max(4_000),
  protectedPaths: z.array(relativePath).max(500),
  exactOperations: z.array(boundedText).min(1).max(30),
  limitations: z.array(boundedText).min(1).max(30),
  requiresApproval: z.boolean(),
  reversible: z.literal(true)
});

export const restoreManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  checkpointId: z.string().trim().min(1).max(160),
  baseline: z.string().regex(/^[a-f0-9]{7,64}$/).nullable(),
  productOwnedFiles: z.array(z.strictObject({
    path: relativePath,
    beforeSha256: digest.nullable(),
    afterSha256: digest
  })).max(2_000),
  unrelatedUserPaths: z.array(relativePath).max(4_000)
});

export const starterTaskSchema = z.strictObject({
  id: z.string().trim().min(1).max(160),
  title: boundedText,
  reason: boundedText,
  effect: z.enum(["read_only", "local_reversible"]),
  estimatedMinutes: z.number().int().min(1).max(9)
});

export const firstJourneyPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().trim().min(1).max(160),
  recommendedTask: starterTaskSchema,
  expectedMinutes: z.number().int().min(1).max(9),
  providerPosture: boundedText,
  localResources: boundedText,
  effects: z.array(boundedText).min(1).max(20),
  evidence: z.array(boundedText).min(1).max(20),
  undo: boundedText
});

export const journeyEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().regex(/^project_[a-f0-9]{12}$/),
  stage: z.enum(["select", "analyze", "plan", "preview", "decision"]),
  outcome: z.enum(["started", "completed", "abandoned", "failed"]),
  failureClass: z.enum([
    "invalid_input",
    "permission",
    "unsupported",
    "dependency",
    "validation",
    "interrupted"
  ]).nullable(),
  occurredAt: z.number().int().nonnegative()
});

export type ProjectEntryRequest = z.infer<typeof projectEntryRequestSchema>;
export type GitInspection = z.infer<typeof gitInspectionSchema>;
export type RepositoryInspection = z.infer<typeof repositoryInspectionSchema>;
export type CanonicalProjectRecord = z.infer<typeof canonicalProjectRecordSchema>;
export type ProjectFile = z.infer<typeof projectFileSchema>;
export type GroundingStatement = z.infer<typeof groundingStatementSchema>;
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
export type CheckpointPlan = z.infer<typeof checkpointPlanSchema>;
export type RestoreManifest = z.infer<typeof restoreManifestSchema>;
export type StarterTask = z.infer<typeof starterTaskSchema>;
export type FirstJourneyPlan = z.infer<typeof firstJourneyPlanSchema>;
export type JourneyEvent = z.infer<typeof journeyEventSchema>;
