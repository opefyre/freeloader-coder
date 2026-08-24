import { z } from "zod";

const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const planItemId = z.string().regex(/^plan_[a-f0-9]{16}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const gitDigest = z.string().regex(/^[a-f0-9]{40,64}$/);
const relativeFile = z.string().trim().min(1).max(500).refine((value) => !value.startsWith("/") && !value.startsWith("\\") && !value.split(/[\\/]/).includes(".."), "Execution files must remain project-relative.");

export const executionAssignmentSchema = z.strictObject({
  providerId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200),
  deviceId: z.string().trim().min(1).max(160),
  selectedAt: z.number().int().nonnegative(),
  reasons: z.array(z.string().trim().min(3).max(300)).min(1).max(20),
});

export const executionLeaseSchema = z.strictObject({
  leaseId: z.string().regex(/^execlease_[a-f0-9]{20}$/),
  ownerId: z.string().trim().min(1).max(160),
  acquiredAt: z.number().int().nonnegative(),
  heartbeatAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).refine((lease) => lease.acquiredAt <= lease.heartbeatAt && lease.heartbeatAt < lease.expiresAt, "Execution lease timestamps are invalid.");

export const executionValidationSchema = z.strictObject({
  tier: z.enum(["fast", "full", "integration"]),
  commandLabel: z.string().trim().min(1).max(200),
  passed: z.boolean(),
  exitCode: z.number().int(),
  evidenceDigest: digest,
  observedAt: z.number().int().nonnegative(),
});

export const executionReviewSchema = z.strictObject({
  reviewerId: z.string().trim().min(3).max(160),
  providerId: z.string().trim().min(1).max(100),
  role: z.enum(["functional", "design", "security", "risk"]),
  verdict: z.enum(["pass", "fail", "needs_user"]),
  evidenceDigest: digest,
  findings: z.array(z.string().trim().min(3).max(1_000)).max(100),
  observedAt: z.number().int().nonnegative(),
});

export const executionAttemptSchema = z.strictObject({
  approvalId: z.string().regex(/^approval_[a-f0-9]{20}$/),
  priorRevision: z.number().int().nonnegative(),
  implementerProviderId: z.string().trim().min(1).max(100).nullable(),
  implementationEvidence: z.array(digest).max(100),
  validations: z.array(executionValidationSchema).max(100),
  // A bounded repair can be triggered by deterministic validation dissent
  // before any independent reviewer runs, so the archived review set may be empty.
  reviews: z.array(executionReviewSchema).max(20),
  rationale: z.string().trim().min(10).max(2_000),
  decidedAt: z.number().int().nonnegative(),
});

export const executionTaskSchema = z.strictObject({
  id: planItemId,
  jiraIssueKey: z.string().trim().min(2).max(100),
  title: z.string().trim().min(3).max(200),
  dependsOn: z.array(planItemId).max(100),
  allowedFiles: z.array(relativeFile).min(1).max(100),
  validationProfiles: z.array(z.enum(["format", "lint", "typecheck", "unit", "integration", "build", "visual"])).min(1).max(7),
  uiChanged: z.boolean(),
  requiredCapabilities: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  privacyClass: z.enum(["public", "non_personal_test", "source_code", "private_local"]),
  status: z.enum(["queued", "running", "validating", "reviewing", "healing", "integrating", "completed", "needs_user", "quarantined"]),
  revision: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative().max(20),
  assignment: executionAssignmentSchema.nullable(),
  deferredProviderIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  verifiedRecoveryEvidenceDigest: digest.nullable().optional(),
  lease: executionLeaseSchema.nullable(),
  implementationEvidence: z.array(digest).max(100),
  validations: z.array(executionValidationSchema).max(100),
  reviews: z.array(executionReviewSchema).max(20),
  reviewAttempts: z.array(executionAttemptSchema).max(20).optional(),
  commitDigest: gitDigest.nullable(),
  integrationDigest: digest.nullable(),
  failureClass: z.enum(["implementation", "environment", "flaky", "provider", "contract", "product_decision", "unsafe"]).nullable(),
  safeMessage: z.string().trim().min(1).max(500),
  updatedAt: z.number().int().nonnegative(),
});

export const projectExecutionRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  planDigest: digest,
  state: z.enum(["running", "needs_user", "quarantined", "completed"]),
  revision: z.number().int().nonnegative(),
  tasks: z.array(executionTaskSchema).min(1).max(2_000),
  updatedAt: z.number().int().nonnegative(),
}).superRefine((record, context) => {
  const ids = new Set(record.tasks.map((task) => task.id));
  if (ids.size !== record.tasks.length) context.addIssue({ code: "custom", path: ["tasks"], message: "Execution task IDs must be unique." });
  for (const [index, task] of record.tasks.entries()) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length || task.dependsOn.includes(task.id) || task.dependsOn.some((dependency) => !ids.has(dependency))) context.addIssue({ code: "custom", path: ["tasks", index, "dependsOn"], message: "Execution dependencies must be unique, non-self, and local to the project." });
    if ((task.status === "running" || task.status === "integrating") && (!task.lease || !task.assignment)) context.addIssue({ code: "custom", path: ["tasks", index], message: "Running and integrating tasks require an assignment and authoritative lease." });
    if (task.status === "completed" && (task.lease || !completionEvidence(task))) context.addIssue({ code: "custom", path: ["tasks", index], message: "Completed tasks require released leases, deterministic validation, and independent review evidence." });
  }
});

export const executionCandidateSchema = z.strictObject({
  providerId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200),
  deviceId: z.string().trim().min(1).max(160),
  capabilities: z.array(z.string().trim().min(1).max(100)).max(100),
  privacyClasses: z.array(z.enum(["public", "non_personal_test", "source_code", "private_local"])).min(1),
  quotaAvailable: z.boolean(),
  billingEnabled: z.boolean(),
  activeRequests: z.number().int().nonnegative(),
  safeConcurrency: z.number().int().positive(),
  availableMemoryMb: z.number().int().nonnegative(),
  requiredMemoryMb: z.number().int().nonnegative(),
  deviceLoad: z.number().min(0).max(1),
  preference: z.number().int().min(0).max(1_000),
});

export type ProjectExecutionRecord = z.infer<typeof projectExecutionRecordSchema>;
export type ExecutionTask = z.infer<typeof executionTaskSchema>;
export type ExecutionCandidate = z.infer<typeof executionCandidateSchema>;

export function selectExecutionAssignment(input: { task: ExecutionTask; candidates: readonly ExecutionCandidate[]; now: number }) {
  const eligible = input.candidates.map((candidate) => executionCandidateSchema.parse(candidate)).filter((candidate) =>
    !candidate.billingEnabled &&
    candidate.quotaAvailable &&
    candidate.activeRequests < candidate.safeConcurrency &&
    candidate.availableMemoryMb >= candidate.requiredMemoryMb &&
    candidate.deviceLoad < 0.9 &&
    input.task.requiredCapabilities.every((capability) => candidate.capabilities.includes(capability)) &&
    candidate.privacyClasses.includes(input.task.privacyClass)
  ).sort((left, right) => score(right) - score(left) || left.providerId.localeCompare(right.providerId) || left.modelId.localeCompare(right.modelId));
  const selected = eligible[0];
  if (!selected) return null;
  return executionAssignmentSchema.parse({
    providerId: selected.providerId,
    modelId: selected.modelId,
    deviceId: selected.deviceId,
    selectedAt: input.now,
    reasons: [
      `${selected.providerId}/${selected.modelId} was selected for the required role on ${selected.deviceId}.`,
      `Required capabilities and ${input.task.privacyClass.replaceAll("_", " ")} privacy handling are supported.`,
      "Verified free quota, device memory, load, and concurrency are currently available; paid routing is disabled.",
    ],
  });
}

export function eligibleExecutionTasks(record: ProjectExecutionRecord, now: number) {
  const completed = new Set(record.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  const occupiedFiles = new Set(record.tasks.filter((task) =>
    ["running", "validating", "reviewing", "healing", "integrating"].includes(task.status) && task.lease !== null && task.lease.expiresAt > now
  ).flatMap((task) => task.allowedFiles));
  return record.tasks.filter((task) => task.status === "queued" && task.dependsOn.every((dependency) => completed.has(dependency)) && (!task.lease || task.lease.expiresAt <= now) && task.allowedFiles.every((file) => !occupiedFiles.has(file)));
}

export function completionEvidence(task: ExecutionTask) {
  const validationTiers = new Set(task.validations.filter((validation) => validation.passed).map((validation) => validation.tier));
  const passedReviews = task.reviews.filter((review) => review.verdict === "pass");
  const roles = new Set(passedReviews.map((review) => review.role));
  return task.implementationEvidence.length > 0 && validationTiers.has("fast") && validationTiers.has("full") && validationTiers.has("integration") && task.commitDigest !== null && task.integrationDigest !== null && roles.has("functional") && (!task.uiChanged || roles.has("design")) && new Set(passedReviews.map((review) => review.reviewerId)).size >= 2 && task.assignment !== null && passedReviews.some((review) => review.providerId !== task.assignment?.providerId);
}

function score(candidate: ExecutionCandidate) { return candidate.preference * 1_000 + (candidate.safeConcurrency - candidate.activeRequests) * 100 + Math.floor((1 - candidate.deviceLoad) * 100) + Math.min(99, Math.floor((candidate.availableMemoryMb - candidate.requiredMemoryMb) / 256)); }
