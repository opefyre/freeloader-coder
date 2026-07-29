import { z } from "zod";

const timestamp = z.number().int().nonnegative();
const identity = z.string().regex(/^attention_[a-f0-9]{20}$/);
const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const providerId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/);

export const attentionSeveritySchema = z.enum(["critical", "high", "medium", "info"]);
export const attentionCategorySchema = z.enum(["action", "recovery", "provider", "completion", "security", "system"]);
export const attentionDispositionSchema = z.enum(["unread", "read", "acknowledged", "snoozed"]);
export const attentionReferenceSchema = z.strictObject({
  surface: z.enum(["attention", "work", "projects", "providers", "evidence", "settings", "activity", "decisions", "trust"]),
  path: z.string().regex(/^\/(?:attention|work|projects|providers|evidence|settings|activity|decisions|trust)(?:\?[a-zA-Z0-9._~!$&'()*+,;=:@%/?-]*)?$/).max(400),
  label: z.string().trim().min(1).max(80),
});
export const attentionQuerySchema = z.strictObject({
  severities: z.array(attentionSeveritySchema).max(4).default([]),
  categories: z.array(attentionCategorySchema).max(6).default([]),
  dispositions: z.array(attentionDispositionSchema).max(4).default([]),
  projectId: projectId.nullable().default(null),
  providerId: providerId.nullable().default(null),
  search: z.string().trim().max(80).default(""),
  includeSuppressed: z.boolean().default(true),
});
export const attentionItemSchema = z.strictObject({
  id: identity,
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  revision: z.number().int().nonnegative(),
  severity: attentionSeveritySchema,
  category: attentionCategorySchema,
  disposition: attentionDispositionSchema,
  suppressed: z.boolean(),
  repeatCount: z.number().int().min(1).max(10_000),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(400),
  nextAction: z.string().trim().min(1).max(160),
  authorityBoundary: z.string().trim().min(1).max(120),
  effect: z.enum(["none", "local_read", "local_preference_write"]),
  maximumCostUsd: z.literal(0),
  observedAt: timestamp,
  firstObservedAt: timestamp,
  snoozedUntil: timestamp.nullable(),
  projectId: projectId.nullable(),
  requestId: requestId.nullable(),
  providerId: providerId.nullable(),
  source: z.enum(["decision", "live_operation", "provider", "autonomy", "policy", "system"]),
  sourceRecordId: z.string().trim().min(1).max(160),
  evidence: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
  reference: attentionReferenceSchema,
});
const facet = z.array(z.strictObject({ value: z.string().min(1).max(160), count: z.number().int().nonnegative().max(500) })).max(500);
export const quietHoursSchema = z.strictObject({
  enabled: z.boolean(),
  startMinute: z.number().int().min(0).max(1_439),
  endMinute: z.number().int().min(0).max(1_439),
  timeZone: z.string().trim().min(1).max(80),
  criticalBypass: z.literal(true),
});
export const attentionSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_attention_center"),
  observedAt: timestamp,
  validForMs: z.number().int().min(1_000).max(60_000),
  automaticSpendLimitUsd: z.literal(0),
  revision: z.number().int().nonnegative(),
  query: attentionQuerySchema,
  summary: z.strictObject({
    total: z.number().int().nonnegative().max(500),
    unread: z.number().int().nonnegative().max(500),
    badge: z.number().int().nonnegative().max(99),
    critical: z.number().int().nonnegative().max(500),
    snoozed: z.number().int().nonnegative().max(500),
    suppressed: z.number().int().nonnegative().max(500),
    oldestObservedAt: timestamp.nullable(),
  }),
  facets: z.strictObject({ severities: facet, categories: facet, dispositions: facet, projects: facet, providers: facet }),
  quietHours: quietHoursSchema,
  quietHoursActive: z.boolean(),
  nextDeliveryAt: timestamp.nullable(),
  retention: z.strictObject({ bounded: z.literal(true), maximumItems: z.literal(250), maximumReceipts: z.literal(500), completeness: z.literal("bounded_current_state") }),
  items: z.array(attentionItemSchema).max(250),
});

export const attentionActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("read"), itemId: identity, expectedRevision: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal("acknowledge"), itemId: identity, expectedRevision: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal("snooze"), itemId: identity, expectedRevision: z.number().int().nonnegative(), durationMinutes: z.number().int().min(5).max(10_080) }),
  z.strictObject({ action: z.literal("unsnooze"), itemId: identity, expectedRevision: z.number().int().nonnegative() }),
]);
export const quietHoursUpdateSchema = quietHoursSchema;
export const attentionPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  previewId: z.string().regex(/^attention_preview_[a-f0-9]{20}$/),
  action: z.enum(["read", "acknowledge", "snooze", "unsnooze", "quiet_hours"]),
  target: z.string().trim().min(1).max(160),
  effect: z.literal("local_preference_write"),
  reversible: z.literal(true),
  maximumCostUsd: z.literal(0),
  previousRevision: z.number().int().nonnegative(),
  nextDisposition: attentionDispositionSchema.nullable(),
  effectiveAt: timestamp,
  expiresAt: timestamp,
});
export const attentionReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^attention_receipt_[a-f0-9]{20}$/),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9._:-]{16,128}$/),
  action: z.enum(["read", "acknowledge", "snooze", "unsnooze", "quiet_hours"]),
  target: z.string().trim().min(1).max(160),
  previousRevision: z.number().int().nonnegative(),
  nextRevision: z.number().int().positive(),
  appliedAt: timestamp,
  outcome: z.literal("applied"),
});
export const attentionMutationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  snapshot: attentionSnapshotSchema,
  receipt: attentionReceiptSchema,
});

export type AttentionSeverity = z.infer<typeof attentionSeveritySchema>;
export type AttentionCategory = z.infer<typeof attentionCategorySchema>;
export type AttentionDisposition = z.infer<typeof attentionDispositionSchema>;
export type AttentionQuery = z.infer<typeof attentionQuerySchema>;
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type AttentionSnapshot = z.infer<typeof attentionSnapshotSchema>;
export type AttentionAction = z.infer<typeof attentionActionSchema>;
export type QuietHours = z.infer<typeof quietHoursSchema>;
export type AttentionPreview = z.infer<typeof attentionPreviewSchema>;
export type AttentionMutationResponse = z.infer<typeof attentionMutationResponseSchema>;
