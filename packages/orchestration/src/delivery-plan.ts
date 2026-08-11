import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const itemId = z.string().regex(/^plan_[a-f0-9]{16}$/);
const detail = z.string().trim().min(10).max(2_000);
const relativeFile = z.string().trim().min(1).max(500).refine((value) => !value.startsWith("/") && !value.startsWith("\\") && !value.split(/[\\/]/).includes(".."), "Allowed files must be safe project-relative paths.");
const validationProfile = z.enum(["format", "lint", "typecheck", "unit", "integration", "build", "visual"]);
const solutionRequirement = z.enum(["behavior", "architecture", "user_experience", "data", "integrations", "security", "privacy", "reliability", "rollout", "metrics"]);

export const deliveryPlanItemSchema = z.strictObject({
  id: itemId,
  type: z.enum(["epic", "story", "task", "subtask"]),
  parentId: itemId.nullable(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(40).max(10_000),
  storyPoints: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13)]).nullable(),
  estimatedMinutes: z.number().int().positive().max(100_000),
  priority: z.enum(["highest", "high", "medium", "low", "lowest"]),
  dependencies: z.array(itemId).max(100),
  acceptanceCriteria: z.array(detail).min(2).max(50),
  definitionOfDone: z.array(detail).min(2).max(50),
  implementationNotes: z.array(detail).min(1).max(100),
  roleCapabilities: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
  rollbackRequirements: z.array(detail).min(1).max(20),
  allowedFiles: z.array(relativeFile).max(100).default([]),
  validationProfiles: z.array(validationProfile).max(7).default([]),
  citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(100),
});

const coverageEntrySchema = z.strictObject({ requirement: solutionRequirement, itemIds: z.array(itemId).min(1).max(100), validationProfiles: z.array(validationProfile).min(1).max(7), citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(20) });
const deliveryGateSchema = z.strictObject({ id: z.string().regex(/^gate_[a-f0-9]{16}$/), kind: z.enum(["owner_approval", "infrastructure"]), title: z.string().trim().min(3).max(200), rationale: detail, beforeItemIds: z.array(itemId).min(1).max(100) });

export const deliveryPlanContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string().trim().min(3).max(200),
  objective: z.string().trim().min(40).max(10_000),
  contextDigest: digest,
  solutionDigest: digest,
  items: z.array(deliveryPlanItemSchema).min(4).max(1_000),
  coverage: z.array(coverageEntrySchema).length(10),
  gates: z.array(deliveryGateSchema).min(1).max(100),
  risks: z.array(detail).min(1).max(100),
  assumptions: z.array(detail).max(100),
  citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500),
}).superRefine((plan, context) => { validatePlan(plan.items, context); validateCoverage(plan, context); });

export const deliveryPlanReviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  reviewerId: z.string().trim().min(3).max(160),
  discipline: z.enum(["delivery", "technical"]),
  verdict: z.enum(["pass", "fail"]),
  findings: z.array(z.string().trim().min(3).max(1_000)).max(100),
});

const passedReviewSchema = deliveryPlanReviewSchema.extend({ verdict: z.literal("pass") });

export const deliveryPlanDraftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  objective: z.string().trim().min(40).max(10_000),
  contextDigest: digest,
  solutionDigest: digest,
  items: z.array(deliveryPlanItemSchema).min(4).max(1_000),
  coverage: z.array(coverageEntrySchema).length(10),
  gates: z.array(deliveryGateSchema).min(1).max(100),
  risks: z.array(detail).min(1).max(100),
  assumptions: z.array(detail).max(100),
  citations: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500),
  reviews: z.array(passedReviewSchema).length(2),
}).superRefine((plan, context) => { validatePlan(plan.items, context); validateCoverage(plan, context); });

export const deliveryPlanDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  projectRelativePath: z.literal(".pipeline/BACKLOG.md"),
  revision: z.number().int().positive(),
  digest,
  markdown: z.string().min(1).max(4_000_000),
  itemCount: z.number().int().positive().max(1_000),
});

export const deliveryPlanRunSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.string().regex(/^project_[a-f0-9]{16}$/),
  state: z.enum(["queued", "running", "deferred", "needs_user", "completed"]),
  attempts: z.number().int().nonnegative(),
  retryAt: z.number().int().positive().nullable(),
  safeMessage: z.string().trim().min(1).max(500),
  updatedAt: z.number().int().nonnegative(),
});

export type DeliveryPlanContent = z.infer<typeof deliveryPlanContentSchema>;
export type DeliveryPlanDraft = z.infer<typeof deliveryPlanDraftSchema>;
export type DeliveryPlanDocument = z.infer<typeof deliveryPlanDocumentSchema>;
export type DeliveryPlanReview = z.infer<typeof deliveryPlanReviewSchema>;
export type DeliveryPlanRun = z.infer<typeof deliveryPlanRunSchema>;

function validatePlan(items: readonly z.infer<typeof deliveryPlanItemSchema>[], context: z.RefinementCtx) {
  const byId = new Map<string, (typeof items)[number]>();
  for (const [index, item] of items.entries()) {
    if (byId.has(item.id)) context.addIssue({ code: "custom", path: ["items", index, "id"], message: "Delivery plan item IDs must be unique." });
    byId.set(item.id, item);
    const expectedParent = ({ epic: null, story: "epic", task: "story", subtask: "task" } as const)[item.type];
    if (expectedParent === null && item.parentId !== null) context.addIssue({ code: "custom", path: ["items", index, "parentId"], message: "Epics cannot have a parent." });
    if (item.type === "subtask" && (item.estimatedMinutes < 60 || item.estimatedMinutes > 120)) context.addIssue({ code: "custom", path: ["items", index, "estimatedMinutes"], message: "Subtasks must be executable in one to two hours." });
    if (item.type === "subtask" && (item.allowedFiles.length === 0 || item.validationProfiles.length === 0)) context.addIssue({ code: "custom", path: ["items", index], message: "Subtasks require explicit file and validation authority." });
    if ((item.type === "story" || item.type === "task") !== (item.storyPoints !== null)) context.addIssue({ code: "custom", path: ["items", index, "storyPoints"], message: "Stories and tasks require story points; epics and subtasks do not." });
    if (new Set(item.dependencies).size !== item.dependencies.length || item.dependencies.includes(item.id)) context.addIssue({ code: "custom", path: ["items", index, "dependencies"], message: "Dependencies must be unique and cannot reference the item itself." });
  }
  for (const [index, item] of items.entries()) {
    if (item.parentId) {
      const parent = byId.get(item.parentId);
      const expected = ({ story: "epic", task: "story", subtask: "task" } as const)[item.type as "story" | "task" | "subtask"];
      if (!parent || parent.type !== expected) context.addIssue({ code: "custom", path: ["items", index, "parentId"], message: `${item.type} requires a ${expected} parent in the same plan.` });
    } else if (item.type !== "epic") context.addIssue({ code: "custom", path: ["items", index, "parentId"], message: `${item.type} requires a parent.` });
    for (const dependency of item.dependencies) if (!byId.has(dependency)) context.addIssue({ code: "custom", path: ["items", index, "dependencies"], message: "Dependencies must reference items in the same plan." });
  }
  for (const item of items) if (hasCycle(item.id, byId, new Set())) context.addIssue({ code: "custom", path: ["items"], message: "Delivery plan dependencies must be acyclic." });
  for (const type of ["epic", "story", "task", "subtask"] as const) if (!items.some((item) => item.type === type)) context.addIssue({ code: "custom", path: ["items"], message: `Delivery plan requires at least one ${type}.` });
  for (const item of items.filter((candidate) => candidate.type !== "subtask")) if (!items.some((candidate) => candidate.parentId === item.id)) context.addIssue({ code: "custom", path: ["items"], message: `${item.type} ${item.id} is orphaned from executable child work.` });
}

function hasCycle(id: string, byId: ReadonlyMap<string, z.infer<typeof deliveryPlanItemSchema>>, ancestors: Set<string>): boolean {
  if (ancestors.has(id)) return true;
  const item = byId.get(id);
  if (!item) return false;
  const next = new Set(ancestors); next.add(id);
  return item.dependencies.some((dependency) => hasCycle(dependency, byId, next));
}

function validateCoverage(plan: { items: readonly z.infer<typeof deliveryPlanItemSchema>[]; coverage: readonly z.infer<typeof coverageEntrySchema>[]; gates: readonly z.infer<typeof deliveryGateSchema>[] }, context: z.RefinementCtx) {
  const ids = new Set(plan.items.map((item) => item.id));
  const subtasks = new Set(plan.items.filter((item) => item.type === "subtask").map((item) => item.id));
  const expected = new Set(solutionRequirement.options);
  const seen = new Set<string>();
  for (const [index, entry] of plan.coverage.entries()) {
    if (seen.has(entry.requirement)) context.addIssue({ code: "custom", path: ["coverage", index, "requirement"], message: "Each approved solution requirement must appear exactly once in the coverage matrix." });
    seen.add(entry.requirement);
    if (entry.itemIds.some((id) => !ids.has(id))) context.addIssue({ code: "custom", path: ["coverage", index, "itemIds"], message: "Coverage may reference only work in this delivery plan." });
    if (!entry.itemIds.some((id) => subtasks.has(id))) context.addIssue({ code: "custom", path: ["coverage", index, "itemIds"], message: "Every requirement must map to executable subtask work." });
  }
  for (const requirement of expected) if (!seen.has(requirement)) context.addIssue({ code: "custom", path: ["coverage"], message: `Coverage is missing approved solution requirement ${requirement}.` });
  const gateIds = new Set<string>();
  for (const [index, gate] of plan.gates.entries()) {
    if (gateIds.has(gate.id)) context.addIssue({ code: "custom", path: ["gates", index, "id"], message: "Delivery gate IDs must be unique." });
    gateIds.add(gate.id);
    if (gate.beforeItemIds.some((id) => !ids.has(id))) context.addIssue({ code: "custom", path: ["gates", index, "beforeItemIds"], message: "Delivery gates may reference only work in this plan." });
  }
}
