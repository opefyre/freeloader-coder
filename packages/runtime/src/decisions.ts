import { z } from "zod";

const timestamp = z.number().int().nonnegative();
const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const providerId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/);

export const decisionCategorySchema = z.enum(["approval", "input", "failure", "recovery", "provider", "project", "policy", "conflict"]);
export const decisionPrioritySchema = z.enum(["critical", "high", "medium", "low"]);
export const decisionOwnerSchema = z.enum(["user", "system", "provider", "external_service"]);
export const decisionAgeSchema = z.enum(["new", "recent", "aging", "overdue"]);
export const decisionRangeSchema = z.enum(["24h", "7d", "30d", "all"]);
export const decisionReferenceSchema = z.strictObject({
  surface: z.enum(["work", "projects", "providers", "evidence", "settings", "activity", "decisions"]),
  path: z.string().regex(/^\/(?:work|projects|providers|evidence|settings|activity|decisions)(?:\?[a-zA-Z0-9._~!$&'()*+,;=:@%/?-]*)?$/).max(400),
  label: z.string().trim().min(1).max(80),
});
export const decisionQuerySchema = z.strictObject({
  range: decisionRangeSchema.default("7d"),
  categories: z.array(decisionCategorySchema).max(8).default([]),
  priorities: z.array(decisionPrioritySchema).max(4).default([]),
  owners: z.array(decisionOwnerSchema).max(4).default([]),
  ages: z.array(decisionAgeSchema).max(4).default([]),
  projectId: projectId.nullable().default(null),
  providerId: providerId.nullable().default(null),
  search: z.string().trim().max(80).default(""),
});
export const decisionItemSchema = z.strictObject({
  id: z.string().regex(/^decision_[a-f0-9]{20}$/),
  category: decisionCategorySchema,
  priority: decisionPrioritySchema,
  owner: decisionOwnerSchema,
  age: decisionAgeSchema,
  state: z.enum(["open", "waiting", "expired", "unavailable"]),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(400),
  nextAction: z.string().trim().min(1).max(160),
  authorityBoundary: z.string().trim().min(1).max(120),
  effect: z.enum(["none", "local_read", "authorized_local_write", "provider_request", "external_write"]),
  maximumCostUsd: z.literal(0),
  reversible: z.boolean(),
  observedAt: timestamp,
  deadlineAt: timestamp.nullable(),
  retryAt: timestamp.nullable(),
  projectId: projectId.nullable(),
  requestId: requestId.nullable(),
  providerId: providerId.nullable(),
  source: z.enum(["live_request", "project_observation", "provider_connection", "system_observation", "autonomy_recommendation", "autonomy_lease", "autonomy_receipt", "project_clarification", "project_solution"]),
  sourceRecordId: z.string().trim().min(1).max(160),
  evidence: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
  reference: decisionReferenceSchema,
});
const facetSchema = z.array(z.strictObject({ value: z.string().trim().min(1).max(160), count: z.number().int().nonnegative().max(500) })).max(500);
export const decisionSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_decision_inbox"),
  observedAt: timestamp,
  validForMs: z.number().int().min(1_000).max(60_000),
  automaticSpendLimitUsd: z.literal(0),
  query: decisionQuerySchema,
  summary: z.strictObject({
    open: z.number().int().nonnegative().max(500),
    critical: z.number().int().nonnegative().max(500),
    overdue: z.number().int().nonnegative().max(500),
    approvals: z.number().int().nonnegative().max(500),
    blockedProjects: z.number().int().nonnegative().max(100),
    providerWaits: z.number().int().nonnegative().max(100),
    oldestObservedAt: timestamp.nullable(),
  }),
  facets: z.strictObject({
    categories: facetSchema,
    priorities: facetSchema,
    owners: facetSchema,
    ages: facetSchema,
    projects: facetSchema,
    providers: facetSchema,
  }),
  retention: z.strictObject({
    bounded: z.literal(true),
    maximumItems: z.literal(250),
    completeness: z.literal("bounded_current_state"),
    earliestObservedAt: timestamp.nullable(),
  }),
  items: z.array(decisionItemSchema).max(250),
});
export const decisionExportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: timestamp,
  provenance: z.literal("local_decision_inbox_export"),
  privacy: z.literal("redacted_displayed_records_only"),
  completeness: z.literal("bounded_current_state"),
  query: decisionQuerySchema,
  items: z.array(decisionItemSchema).max(250),
});

export type DecisionCategory = z.infer<typeof decisionCategorySchema>;
export type DecisionPriority = z.infer<typeof decisionPrioritySchema>;
export type DecisionOwner = z.infer<typeof decisionOwnerSchema>;
export type DecisionAge = z.infer<typeof decisionAgeSchema>;
export type DecisionRange = z.infer<typeof decisionRangeSchema>;
export type DecisionQuery = z.infer<typeof decisionQuerySchema>;
export type DecisionItem = z.infer<typeof decisionItemSchema>;
export type DecisionSnapshot = z.infer<typeof decisionSnapshotSchema>;
export type DecisionExport = z.infer<typeof decisionExportSchema>;
