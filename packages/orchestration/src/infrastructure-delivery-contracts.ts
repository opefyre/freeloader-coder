import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const detail = z.string().trim().min(3).max(4_000);
const vaultReference = z.string().regex(/^vault:\/\/[a-zA-Z0-9/_-]+$/);

const resourceSchema = z.strictObject({
  provider: z.string().trim().min(2).max(80), accountId: z.string().trim().min(2).max(200),
  projectOrTenantId: z.string().trim().min(2).max(200), resourceId: z.string().trim().min(2).max(300),
  region: z.string().trim().min(2).max(100), kind: z.string().trim().min(2).max(100),
  freeTierVerifiedAt: z.number().int().nonnegative(), billingEnabled: z.boolean(),
  promotionalCreditOnly: z.boolean(), evidence: z.array(detail).min(1).max(20),
});

export const infrastructureDesignSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId, requestId, contextDigest: digest, solutionDigest: digest, approvedSolutionDigest: digest,
  environments: z.array(z.strictObject({ name: z.string().trim().min(2).max(80), purpose: detail, promotionFrom: z.string().trim().min(2).max(80).nullable() })).min(1).max(12),
  topology: z.array(detail).min(1).max(50),
  services: z.array(z.strictObject({ name: z.string().trim().min(2).max(100), purpose: detail, runtime: detail, dependencies: z.array(z.string().trim().min(2).max(100)).max(30) })).min(1).max(100),
  resources: z.array(resourceSchema).min(1).max(200), infrastructureAsCode: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  secrets: z.array(z.strictObject({ purpose: detail, reference: vaultReference, consumers: z.array(z.string().trim().min(2).max(100)).min(1).max(50) })).max(100),
  networking: z.array(detail).min(1).max(50), dataAndBackups: z.array(detail).min(1).max(50), observability: z.array(detail).min(1).max(50),
  deployment: z.array(detail).min(1).max(50), rollback: z.array(detail).min(1).max(50), runbook: z.array(detail).min(1).max(100),
  alternatives: z.array(z.strictObject({ option: detail, decision: detail, citations: z.array(detail).min(1).max(20) })).min(1).max(30),
  citations: z.array(detail).min(1).max(100),
}).superRefine((design, context) => {
  if (design.solutionDigest !== design.approvedSolutionDigest) context.addIssue({ code: "custom", path: ["approvedSolutionDigest"], message: "Infrastructure design must be bound to the exact approved solution." });
  for (const [index, resource] of design.resources.entries()) if (resource.billingEnabled || resource.promotionalCreditOnly) context.addIssue({ code: "custom", path: ["resources", index], message: "Only verified zero-cost resources with billing disabled are eligible." });
});
export type InfrastructureDesign = z.infer<typeof infrastructureDesignSchema>;

const infrastructureMutationPreviewBaseSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().regex(/^infra_preview_[a-f0-9]{20}$/), projectId, requestId, designDigest: digest,
  provider: z.string().trim().min(2).max(80), accountId: z.string().trim().min(2).max(200), projectOrTenantId: z.string().trim().min(2).max(200),
  resourceId: z.string().trim().min(2).max(300), region: z.string().trim().min(2).max(100),
  action: z.enum(["create", "configure", "migrate", "deploy", "promote", "delete", "rollback"]),
  permissions: z.array(z.string().trim().min(2).max(200)).min(1).max(50), maximumCostUsd: z.literal(0), reversible: z.boolean(),
  rollbackAction: detail, idempotencyKey: z.string().trim().min(16).max(200), createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(), digest,
});
export const infrastructureMutationPreviewPayloadSchema = infrastructureMutationPreviewBaseSchema.omit({ digest: true });
export const infrastructureMutationPreviewSchema = infrastructureMutationPreviewBaseSchema.superRefine((preview, context) => {
  if (preview.expiresAt <= preview.createdAt) context.addIssue({ code: "custom", path: ["expiresAt"], message: "Infrastructure preview must expire after creation." });
  if (!preview.reversible && preview.action !== "delete") context.addIssue({ code: "custom", path: ["reversible"], message: "Non-delete infrastructure work must provide executable reversal." });
});
export type InfrastructureMutationPreview = z.infer<typeof infrastructureMutationPreviewSchema>;

export const infrastructureApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1), previewId: z.string().regex(/^infra_preview_[a-f0-9]{20}$/), previewDigest: digest,
  approvedBy: z.literal("owner"), approvedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
});
export type InfrastructureApproval = z.infer<typeof infrastructureApprovalSchema>;

export const infrastructureReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), previewId: z.string().regex(/^infra_preview_[a-f0-9]{20}$/), previewDigest: digest,
  state: z.enum(["verified", "rolled_back", "partial", "needs_user"]), providerOperationId: z.string().trim().min(3).max(300),
  endpoint: z.string().url().refine((value) => value.startsWith("https://"), "Infrastructure endpoints must use HTTPS.").nullable(),
  checks: z.array(z.strictObject({ name: z.string().trim().min(2).max(100), passed: z.boolean(), evidence: detail })).min(1).max(100),
  observedAt: z.number().int().nonnegative(), rollbackEvidence: detail.nullable(), safeMessage: detail,
});
export type InfrastructureReceipt = z.infer<typeof infrastructureReceiptSchema>;

export const infrastructureDeliveryStatusSchema = z.strictObject({
  schemaVersion: z.literal(1), design: infrastructureDesignSchema.nullable(),
  operations: z.array(z.strictObject({ preview: infrastructureMutationPreviewSchema, approval: infrastructureApprovalSchema.nullable(), receipt: infrastructureReceiptSchema.nullable() })).max(200),
});
export type InfrastructureDeliveryStatus = z.infer<typeof infrastructureDeliveryStatusSchema>;
