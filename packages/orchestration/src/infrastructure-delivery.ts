import { createHash } from "node:crypto";

import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const projectId = z.string().regex(/^project_[a-f0-9]{16}$/);
const requestId = z.string().regex(/^request_[a-f0-9]{20}$/);
const detail = z.string().trim().min(3).max(4_000);
const vaultReference = z.string().regex(/^vault:\/\/[a-zA-Z0-9/_-]+$/);

const resourceSchema = z.strictObject({
  provider: z.string().trim().min(2).max(80),
  accountId: z.string().trim().min(2).max(200),
  projectOrTenantId: z.string().trim().min(2).max(200),
  resourceId: z.string().trim().min(2).max(300),
  region: z.string().trim().min(2).max(100),
  kind: z.string().trim().min(2).max(100),
  freeTierVerifiedAt: z.number().int().nonnegative(),
  billingEnabled: z.boolean(),
  promotionalCreditOnly: z.boolean(),
  evidence: z.array(detail).min(1).max(20),
});

export const infrastructureDesignSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId,
  requestId,
  contextDigest: digest,
  solutionDigest: digest,
  approvedSolutionDigest: digest,
  environments: z.array(z.strictObject({ name: z.string().trim().min(2).max(80), purpose: detail, promotionFrom: z.string().trim().min(2).max(80).nullable() })).min(1).max(12),
  topology: z.array(detail).min(1).max(50),
  services: z.array(z.strictObject({ name: z.string().trim().min(2).max(100), purpose: detail, runtime: detail, dependencies: z.array(z.string().trim().min(2).max(100)).max(30) })).min(1).max(100),
  resources: z.array(resourceSchema).min(1).max(200),
  infrastructureAsCode: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  secrets: z.array(z.strictObject({ purpose: detail, reference: vaultReference, consumers: z.array(z.string().trim().min(2).max(100)).min(1).max(50) })).max(100),
  networking: z.array(detail).min(1).max(50),
  dataAndBackups: z.array(detail).min(1).max(50),
  observability: z.array(detail).min(1).max(50),
  deployment: z.array(detail).min(1).max(50),
  rollback: z.array(detail).min(1).max(50),
  runbook: z.array(detail).min(1).max(100),
  alternatives: z.array(z.strictObject({ option: detail, decision: detail, citations: z.array(detail).min(1).max(20) })).min(1).max(30),
  citations: z.array(detail).min(1).max(100),
}).superRefine((design, context) => {
  if (design.solutionDigest !== design.approvedSolutionDigest) context.addIssue({ code: "custom", path: ["approvedSolutionDigest"], message: "Infrastructure design must be bound to the exact approved solution." });
  for (const [index, resource] of design.resources.entries()) {
    if (resource.billingEnabled || resource.promotionalCreditOnly) context.addIssue({ code: "custom", path: ["resources", index], message: "Only verified zero-cost resources with billing disabled are eligible." });
  }
});

export type InfrastructureDesign = z.infer<typeof infrastructureDesignSchema>;

const infrastructureMutationPreviewBaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^infra_preview_[a-f0-9]{20}$/),
  projectId,
  requestId,
  designDigest: digest,
  provider: z.string().trim().min(2).max(80),
  accountId: z.string().trim().min(2).max(200),
  projectOrTenantId: z.string().trim().min(2).max(200),
  resourceId: z.string().trim().min(2).max(300),
  region: z.string().trim().min(2).max(100),
  action: z.enum(["create", "configure", "migrate", "deploy", "promote", "delete", "rollback"]),
  permissions: z.array(z.string().trim().min(2).max(200)).min(1).max(50),
  maximumCostUsd: z.literal(0),
  reversible: z.boolean(),
  rollbackAction: detail,
  idempotencyKey: z.string().trim().min(16).max(200),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  digest,
});
const infrastructureMutationPreviewPayloadSchema = infrastructureMutationPreviewBaseSchema.omit({ digest: true });
export const infrastructureMutationPreviewSchema = infrastructureMutationPreviewBaseSchema.superRefine((preview, context) => {
  if (preview.expiresAt <= preview.createdAt) context.addIssue({ code: "custom", path: ["expiresAt"], message: "Infrastructure preview must expire after creation." });
  if (!preview.reversible && preview.action !== "delete") context.addIssue({ code: "custom", path: ["reversible"], message: "Non-delete infrastructure work must provide executable reversal." });
});

export type InfrastructureMutationPreview = z.infer<typeof infrastructureMutationPreviewSchema>;

export const infrastructureApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  previewId: z.string().regex(/^infra_preview_[a-f0-9]{20}$/),
  previewDigest: digest,
  approvedBy: z.literal("owner"),
  approvedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type InfrastructureApproval = z.infer<typeof infrastructureApprovalSchema>;

export const infrastructureReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  previewId: z.string().regex(/^infra_preview_[a-f0-9]{20}$/),
  previewDigest: digest,
  state: z.enum(["verified", "rolled_back", "partial", "needs_user"]),
  providerOperationId: z.string().trim().min(3).max(300),
  endpoint: z.string().url().nullable(),
  checks: z.array(z.strictObject({ name: z.string().trim().min(2).max(100), passed: z.boolean(), evidence: detail })).min(1).max(100),
  observedAt: z.number().int().nonnegative(),
  rollbackEvidence: detail.nullable(),
  safeMessage: detail,
});

export type InfrastructureReceipt = z.infer<typeof infrastructureReceiptSchema>;

export interface InfrastructureAdapter {
  apply(preview: InfrastructureMutationPreview): Promise<{ providerOperationId: string; endpoint: string | null; evidence: readonly string[] }>;
  verify(preview: InfrastructureMutationPreview, applied: { providerOperationId: string; endpoint: string | null }): Promise<readonly { name: string; passed: boolean; evidence: string }[]>;
  rollback(preview: InfrastructureMutationPreview, applied: { providerOperationId: string; endpoint: string | null }): Promise<string>;
}

export function digestInfrastructureDesign(design: InfrastructureDesign): string {
  return sha(infrastructureDesignSchema.parse(design));
}

export function renderInfrastructureDocuments(design: InfrastructureDesign): { readonly infra: string; readonly opsRules: string; readonly designDigest: string } {
  const parsed = infrastructureDesignSchema.parse(design);
  const designDigest = digestInfrastructureDesign(parsed);
  const lines = (items: readonly string[]) => items.map((entry) => `- ${entry}`).join("\n");
  const infra = [
    "# Infrastructure", "", `Design digest: \`${designDigest}\``, `Approved solution: \`${parsed.approvedSolutionDigest}\``, "",
    "## Environments and topology", "", ...parsed.environments.map((entry) => `- **${entry.name}** — ${entry.purpose}${entry.promotionFrom ? `; promoted from ${entry.promotionFrom}` : ""}`), "", lines(parsed.topology), "",
    "## Services, data, and networking", "", ...parsed.services.map((entry) => `- **${entry.name}** — ${entry.purpose}; runtime: ${entry.runtime}; dependencies: ${entry.dependencies.join(", ") || "none"}`), "", lines(parsed.networking), "", lines(parsed.dataAndBackups), "",
    "## Infrastructure as code and verified resources", "", lines(parsed.infrastructureAsCode), "", ...parsed.resources.map((entry) => `- **${entry.provider}/${entry.kind}** — account \`${entry.accountId}\`, project \`${entry.projectOrTenantId}\`, resource \`${entry.resourceId}\`, region \`${entry.region}\`; billing disabled; free-tier checked ${new Date(entry.freeTierVerifiedAt).toISOString()}.`), "",
    "## Secrets", "", ...parsed.secrets.map((entry) => `- ${entry.purpose}: \`${entry.reference}\` → ${entry.consumers.join(", ")}`), "",
    "## Deployment, observability, and rollback", "", lines(parsed.deployment), "", lines(parsed.observability), "", lines(parsed.rollback), "",
    "## Alternatives and sources", "", ...parsed.alternatives.map((entry) => `- **${entry.option}** — ${entry.decision} (${entry.citations.join("; ")})`), "", lines(parsed.citations), "",
  ].join("\n");
  const opsRules = [
    "# Operations Rules", "", `Infrastructure authority: \`${designDigest}\``, "",
    "## Infrastructure authority", "", "- Product-design approval does not authorize a cloud mutation.", "- Every external mutation requires a current, exact-digest owner approval.", "- Billing-enabled, paid, promotional-credit-only, stale, or unverified resources fail closed.", "- Credentials are resolved from vault references at execution time and never copied into artifacts, prompts, logs, or Jira.", "- Provider-observed evidence, never model claims, determines deployment status.", "",
    "## Runbook", "", lines(parsed.runbook), "",
    "## Rollback", "", lines(parsed.rollback), "",
  ].join("\n");
  return { infra, opsRules, designDigest };
}

export function createInfrastructureMutationPreview(input: Omit<InfrastructureMutationPreview, "schemaVersion" | "id" | "digest">): InfrastructureMutationPreview {
  const base = { schemaVersion: 1 as const, ...input };
  const token = sha(base).slice(0, 20);
  const withId = infrastructureMutationPreviewPayloadSchema.parse({ ...base, id: `infra_preview_${token}` });
  return infrastructureMutationPreviewSchema.parse({ ...withId, digest: sha(withId) });
}

export function approveInfrastructureMutation(preview: InfrastructureMutationPreview, now: number, ttlMs: number): InfrastructureApproval {
  const parsed = assertPreviewIntegrity(preview);
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || now >= parsed.expiresAt) throw new Error("Infrastructure preview expired and must be regenerated.");
  return infrastructureApprovalSchema.parse({ schemaVersion: 1, previewId: parsed.id, previewDigest: parsed.digest, approvedBy: "owner", approvedAt: now, expiresAt: Math.min(parsed.expiresAt, now + ttlMs) });
}

export async function executeInfrastructureMutation(input: { preview: InfrastructureMutationPreview; approval: InfrastructureApproval; design: InfrastructureDesign; adapter: InfrastructureAdapter; now: number; completed?: ReadonlyMap<string, InfrastructureReceipt> }): Promise<InfrastructureReceipt> {
  const preview = assertPreviewIntegrity(input.preview);
  const approval = infrastructureApprovalSchema.parse(input.approval);
  const design = infrastructureDesignSchema.parse(input.design);
  if (preview.designDigest !== digestInfrastructureDesign(design)) throw new Error("Infrastructure target changed after preview; create a new preview.");
  if (approval.previewId !== preview.id || approval.previewDigest !== preview.digest) throw new Error("Infrastructure approval does not match the exact preview.");
  if (input.now >= preview.expiresAt || input.now >= approval.expiresAt) throw new Error("Infrastructure approval expired before execution.");
  const replay = input.completed?.get(preview.idempotencyKey);
  if (replay) return infrastructureReceiptSchema.parse(replay);
  let applied: { providerOperationId: string; endpoint: string | null } | null = null;
  try {
    const result = await input.adapter.apply(preview);
    applied = { providerOperationId: result.providerOperationId, endpoint: result.endpoint };
    const checks = await input.adapter.verify(preview, applied);
    if (!checks.length || checks.some((check) => !check.passed)) {
      const rollbackEvidence = await input.adapter.rollback(preview, applied);
      return infrastructureReceiptSchema.parse({ schemaVersion: 1, previewId: preview.id, previewDigest: preview.digest, state: "rolled_back", providerOperationId: applied.providerOperationId, endpoint: applied.endpoint, checks, observedAt: input.now, rollbackEvidence, safeMessage: "Deployment verification failed; the exact approved mutation was rolled back." });
    }
    return infrastructureReceiptSchema.parse({ schemaVersion: 1, previewId: preview.id, previewDigest: preview.digest, state: "verified", providerOperationId: applied.providerOperationId, endpoint: applied.endpoint, checks, observedAt: input.now, rollbackEvidence: null, safeMessage: "The provider reports the approved zero-cost deployment healthy." });
  } catch (error) {
    if (!applied) throw error;
    try {
      const rollbackEvidence = await input.adapter.rollback(preview, applied);
      return infrastructureReceiptSchema.parse({ schemaVersion: 1, previewId: preview.id, previewDigest: preview.digest, state: "rolled_back", providerOperationId: applied.providerOperationId, endpoint: applied.endpoint, checks: [{ name: "execution", passed: false, evidence: safeError(error) }], observedAt: input.now, rollbackEvidence, safeMessage: "A partial deployment was detected and rolled back." });
    } catch (rollbackError) {
      return infrastructureReceiptSchema.parse({ schemaVersion: 1, previewId: preview.id, previewDigest: preview.digest, state: "needs_user", providerOperationId: applied.providerOperationId, endpoint: applied.endpoint, checks: [{ name: "execution", passed: false, evidence: safeError(error) }, { name: "rollback", passed: false, evidence: safeError(rollbackError) }], observedAt: input.now, rollbackEvidence: null, safeMessage: "A partial deployment could not be safely reconciled; owner attention is required." });
    }
  }
}

function assertPreviewIntegrity(preview: InfrastructureMutationPreview): InfrastructureMutationPreview {
  const parsed = infrastructureMutationPreviewSchema.parse(preview);
  const { digest: ignored, ...withoutDigest } = parsed;
  if (sha(infrastructureMutationPreviewPayloadSchema.parse(withoutDigest)) !== ignored) throw new Error("Infrastructure preview integrity check failed.");
  return parsed;
}

function sha(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function safeError(error: unknown): string { return error instanceof Error ? error.message.replace(/((?:api[_-]?key|token|secret|password)=)[^\s]+/gi, "$1[redacted]").slice(0, 4_000) : "Unknown infrastructure failure."; }
