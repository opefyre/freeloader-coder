import { z } from "zod";

const boundedLabel = z.string().trim().min(1).max(160);
const opaqueProjectId = z.string().regex(/^project_[a-f0-9]{16}$/);

export const projectLifecycleStageSchema = z.enum([
  "intake",
  "context_review",
  "clarification",
  "solution_design",
  "awaiting_design_approval",
  "backlog_design",
  "backlog_qa",
  "delivery",
  "blocked",
  "complete",
  "cancelled",
]);

export const projectResourceKindSchema = z.enum([
  "jira_project",
  "github_repository",
  "discord_channel",
  "telegram_chat",
  "slack_channel",
  "gmail_account",
  "google_calendar",
  "cloudflare_account",
  "gcloud_project",
  "aws_account",
  "vercel_project",
  "supabase_project",
  "cockroach_database",
  "resend_account",
  "brevo_account",
  "posthog_project",
  "sentry_project",
  "stripe_account",
]);

export const projectResourceBindingSchema = z.strictObject({
  id: z.string().regex(/^binding_[a-f0-9]{16}$/),
  kind: projectResourceKindSchema,
  connectionId: z.string().trim().min(1).max(200),
  resourceId: z.string().trim().min(1).max(500),
  label: boundedLabel,
  url: z.string().url().max(2_048).nullable(),
  role: z.enum(["primary", "additional", "notifications"]),
  selectedAt: z.number().int().nonnegative(),
});

export const projectLatestUpdateSchema = z.strictObject({
  summary: z.string().trim().min(1).max(500),
  source: z.enum(["pipeline", "jira", "github", "owner"]),
  occurredAt: z.number().int().nonnegative(),
  url: z.string().url().max(2_048).nullable(),
});

export const projectProgressSchema = z.strictObject({
  source: z.literal("jira"),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
  observedAt: z.number().int().nonnegative(),
}).superRefine((value, context) => {
  if (value.completed > value.total || value.blocked > value.total) {
    context.addIssue({ code: "custom", message: "Project progress counts are inconsistent." });
  }
});

export const localProjectFactSchema = z.strictObject({
  label: boundedLabel,
  value: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(120),
});

export const localProjectSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: opaqueProjectId,
  displayName: boundedLabel,
  workspaceLabel: boundedLabel.optional(),
  lifecycleStage: projectLifecycleStageSchema.optional(),
  resourceRevision: z.number().int().nonnegative().optional(),
  resourceChange: z.strictObject({
    addedBindingIds: z.array(z.string().regex(/^binding_[a-f0-9]{16}$/)).max(100),
    removedBindingIds: z.array(z.string().regex(/^binding_[a-f0-9]{16}$/)).max(100),
    changedAt: z.number().int().nonnegative(),
  }).optional(),
  resources: z.array(projectResourceBindingSchema).max(100).optional(),
  latestUpdate: projectLatestUpdateSchema.nullable().optional(),
  progress: projectProgressSchema.nullable().optional(),
  state: z.enum(["ready", "warning", "failed"]),
  observedAt: z.number().int().nonnegative(),
  validForMs: z.number().int().min(1_000).max(86_400_000),
  facts: z.array(localProjectFactSchema).max(20),
  inferences: z.array(z.string().trim().min(1).max(500)).max(20),
  decisions: z.array(z.string().trim().min(1).max(500)).max(20),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
});

export const localProjectCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_observation"),
  observedAt: z.number().int().nonnegative(),
  projects: z.array(localProjectSnapshotSchema).max(100),
});

export const localProjectRegistrationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  path: z.string().trim().min(1).max(2_048),
  displayName: boundedLabel.optional(),
});

export const localProjectCreationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  idea: z.string().trim().min(3).max(20_000),
  displayName: boundedLabel.optional(),
  workspacePath: z.string().trim().min(1).max(2_048),
});

export const projectResourceSelectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().nonnegative().default(0),
  resources: z.array(projectResourceBindingSchema.omit({ id: true, selectedAt: true })).max(100),
}).superRefine((value, context) => {
  const primaryJira = value.resources.filter((resource) => resource.kind === "jira_project");
  if (primaryJira.length > 1) context.addIssue({ code: "custom", message: "A project can select only one Jira project." });
  const identities = new Set<string>();
  for (const resource of value.resources) {
    const identity = `${resource.kind}:${resource.connectionId}:${resource.resourceId}`;
    if (identities.has(identity)) context.addIssue({ code: "custom", message: "A project resource can be selected only once." });
    identities.add(identity);
  }
});

export const localProjectFileImportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  paths: z.array(z.string().trim().min(1).max(4_096)).min(1).max(20),
});

export const localProjectFileImportResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("imported"),
  files: z.array(z.strictObject({
    label: z.string().trim().min(1).max(255),
    projectRelativePath: z.string().regex(/^\.pipeline\/inputs\/[a-zA-Z0-9._-]+$/),
    bytes: z.number().int().nonnegative().max(10_000_000),
    evidence: z.strictObject({
      status: z.enum(["extracted", "unsupported", "encrypted", "corrupt", "limit_exceeded"]),
      mediaType: z.string().trim().min(1).max(200),
      sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
      unitCount: z.number().int().nonnegative().max(10_000),
      warning: z.string().trim().min(1).max(300).nullable(),
    }),
  })).min(1).max(20),
});

export const localProjectMutationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["created", "registered", "rescanned", "forgotten"]),
  project: localProjectSnapshotSchema.nullable(),
});

export type LocalProjectSnapshot = z.infer<typeof localProjectSnapshotSchema>;
export type LocalProjectCollection = z.infer<typeof localProjectCollectionSchema>;
export type LocalProjectRegistration = z.infer<typeof localProjectRegistrationSchema>;
export type LocalProjectCreation = z.infer<typeof localProjectCreationSchema>;
export type ProjectResourceBinding = z.infer<typeof projectResourceBindingSchema>;
export type ProjectResourceSelection = z.infer<typeof projectResourceSelectionSchema>;
export type LocalProjectFileImportResponse = z.infer<typeof localProjectFileImportResponseSchema>;

export const projectContextSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: opaqueProjectId,
  path: z.literal("CONTEXT.md"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  groundingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  topologyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.number().int().nonnegative(),
  citations: z.array(z.strictObject({ path: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).{1,240}$/), digest: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(12),
});

export type ProjectContextSnapshot = z.infer<typeof projectContextSnapshotSchema>;
export type LocalProjectMutationResponse = z.infer<
  typeof localProjectMutationResponseSchema
>;

export function validateLocalProjectCollection(input: unknown): LocalProjectCollection {
  const collection = localProjectCollectionSchema.parse(input);
  const ids = collection.projects.map((project) => project.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Local project collection contains duplicate identities.");
  }
  return collection;
}
