import { createHash } from "node:crypto";
import {
  infrastructureApprovalSchema, infrastructureDesignSchema, infrastructureMutationPreviewPayloadSchema,
  infrastructureMutationPreviewSchema, infrastructureReceiptSchema,
  type InfrastructureApproval, type InfrastructureDesign, type InfrastructureMutationPreview, type InfrastructureReceipt,
} from "./infrastructure-delivery-contracts.js";
export * from "./infrastructure-delivery-contracts.js";

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

export async function rollbackInfrastructureMutation(input: { preview: InfrastructureMutationPreview; approval: InfrastructureApproval; design: InfrastructureDesign; receipt: InfrastructureReceipt; adapter: InfrastructureAdapter; now: number }): Promise<InfrastructureReceipt> {
  const preview = assertPreviewIntegrity(input.preview);
  const approval = infrastructureApprovalSchema.parse(input.approval);
  const design = infrastructureDesignSchema.parse(input.design);
  const receipt = infrastructureReceiptSchema.parse(input.receipt);
  if (!preview.reversible || preview.designDigest !== digestInfrastructureDesign(design)) throw new Error("Infrastructure rollback no longer matches the approved design.");
  if (approval.previewId !== preview.id || approval.previewDigest !== preview.digest || receipt.previewId !== preview.id || receipt.previewDigest !== preview.digest) throw new Error("Infrastructure rollback authority does not match the exact deployment.");
  if (receipt.state === "rolled_back") return receipt;
  if (receipt.state !== "verified") throw new Error("Only a provider-verified deployment can be explicitly rolled back.");
  try {
    const rollbackEvidence = await input.adapter.rollback(preview, { providerOperationId: receipt.providerOperationId, endpoint: receipt.endpoint });
    return infrastructureReceiptSchema.parse({ ...receipt, state: "rolled_back", observedAt: input.now, rollbackEvidence, safeMessage: "The exact approved deployment was removed and the provider confirmed rollback." });
  } catch (error) {
    return infrastructureReceiptSchema.parse({ ...receipt, state: "needs_user", observedAt: input.now, checks: [...receipt.checks, { name: "rollback", passed: false, evidence: safeError(error) }], rollbackEvidence: null, safeMessage: "The provider could not confirm rollback of the exact deployment; owner attention is required." });
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
