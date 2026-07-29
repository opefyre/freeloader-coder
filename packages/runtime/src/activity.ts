import { z } from "zod";

const timestamp = z.number().int().nonnegative();
const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const providerId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/);

export const activityKindSchema = z.enum(["request", "project", "provider", "autonomy", "system"]);
export const activitySeveritySchema = z.enum(["neutral", "progress", "success", "attention", "failure"]);
export const activityRangeSchema = z.enum(["all", "1h", "24h", "7d"]);
export const activitySourceSchema = z.enum([
  "request_summary",
  "request_run",
  "project_observation",
  "provider_connection",
  "autonomy_recommendation",
  "autonomy_lease",
  "autonomy_receipt",
  "system_observation",
]);

export const activityQuerySchema = z.strictObject({
  range: activityRangeSchema.default("24h"),
  kinds: z.array(activityKindSchema).max(5).default([]),
  severities: z.array(activitySeveritySchema).max(5).default([]),
  projectId: projectId.nullable().default(null),
  providerId: providerId.nullable().default(null),
  search: z.string().trim().max(80).default(""),
});

export const activityReferenceSchema = z.strictObject({
  surface: z.enum(["work", "projects", "providers", "activity"]),
  path: z.string().regex(/^\/[a-z]+(?:\?[a-zA-Z0-9._=&%-]+)?$/).max(240),
  label: z.string().trim().min(1).max(80),
});

export const activityEventSchema = z.strictObject({
  id: z.string().regex(/^activity_[a-f0-9]{20}$/),
  kind: activityKindSchema,
  severity: activitySeveritySchema,
  source: activitySourceSchema,
  sourceRecordId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/),
  state: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(300),
  observedAt: timestamp,
  projectId: projectId.nullable(),
  requestId: requestId.nullable(),
  providerId: providerId.nullable(),
  reference: activityReferenceSchema,
});

const facetSchema = z.strictObject({
  value: z.string().trim().min(1).max(160),
  count: z.number().int().nonnegative().max(500),
});

export const activitySnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_activity_explorer"),
  observedAt: timestamp,
  validForMs: z.number().int().min(1_000).max(60_000),
  automaticSpendLimitUsd: z.literal(0),
  query: activityQuerySchema,
  summary: z.strictObject({
    observed: z.number().int().nonnegative().max(500),
    active: z.number().int().nonnegative().max(500),
    decisions: z.number().int().nonnegative().max(500),
    failures: z.number().int().nonnegative().max(500),
    recoveries: z.number().int().nonnegative().max(500),
    providers: z.number().int().nonnegative().max(100),
    lastActivityAt: timestamp.nullable(),
  }),
  facets: z.strictObject({
    kinds: z.array(facetSchema).max(5),
    severities: z.array(facetSchema).max(5),
    projects: z.array(facetSchema).max(100),
    providers: z.array(facetSchema).max(100),
  }),
  retention: z.strictObject({
    bounded: z.literal(true),
    maximumEvents: z.literal(250),
    completeness: z.literal("bounded_current_state"),
    earliestObservedAt: timestamp.nullable(),
  }),
  events: z.array(activityEventSchema).max(250),
});

export const activityExportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("pipeline_studio_local_activity_export"),
  generatedAt: timestamp,
  sourceObservedAt: timestamp,
  redaction: z.literal("credentials, personal paths, prompts, source content, and provider bodies excluded"),
  query: activityQuerySchema,
  events: z.array(activityEventSchema).max(250),
});

export type ActivityKind = z.infer<typeof activityKindSchema>;
export type ActivitySeverity = z.infer<typeof activitySeveritySchema>;
export type ActivityRange = z.infer<typeof activityRangeSchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivitySnapshot = z.infer<typeof activitySnapshotSchema>;
export type ActivityExport = z.infer<typeof activityExportSchema>;

export function validateActivitySnapshot(input: unknown): ActivitySnapshot {
  return activitySnapshotSchema.parse(input);
}

export function validateActivityExport(input: unknown): ActivityExport {
  return activityExportSchema.parse(input);
}
