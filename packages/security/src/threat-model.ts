import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

export type ThreatSurface =
  | "project_files"
  | "provider"
  | "connector"
  | "tool"
  | "sandbox"
  | "credential"
  | "update";

export interface ThreatControl {
  readonly id: string;
  readonly title: string;
  readonly surfaces: readonly ThreatSurface[];
  readonly severity: "high" | "critical";
  readonly prevention: string;
  readonly detection: string;
  readonly response: string;
  readonly verification: string;
  readonly owner: string;
  readonly residualRisk: "low" | "medium" | "high";
}

export const threatModelVersion = 1;

export const criticalThreatControls: readonly ThreatControl[] = [
  control("path-escape", "Project path escape", ["project_files", "tool"], "critical", "low"),
  control("symlink-escape", "Symlink escape", ["project_files", "tool"], "critical", "low"),
  control("hostile-hooks", "Hostile package hooks", ["project_files", "sandbox"], "high", "medium"),
  control("prompt-injection", "Prompt injection", ["project_files", "provider"], "high", "medium"),
  control("secret-exfiltration", "Credential exfiltration", ["credential", "provider", "tool"], "critical", "low"),
  control("approval-replay", "Approval bypass or replay", ["connector", "tool"], "critical", "low"),
  control("provider-compromise", "Compromised provider", ["provider"], "high", "high"),
  control("update-compromise", "Compromised update", ["update"], "critical", "medium")
] as const;

export interface ReleaseRiskDecision {
  readonly threatId: string;
  readonly owner: string;
  readonly acceptedAt: number;
  readonly expiresAt: number;
  readonly rationale: string;
}

export function evaluateThreatRelease(input: {
  readonly changedSurfaces: readonly ThreatSurface[];
  readonly decisions: readonly ReleaseRiskDecision[];
  readonly now: number;
}): {
  readonly allowed: boolean;
  readonly blockedThreatIds: readonly string[];
  readonly reviewRequiredThreatIds: readonly string[];
} {
  const affected = criticalThreatControls.filter((entry) =>
    entry.surfaces.some((surface) => input.changedSurfaces.includes(surface))
  );
  const reviewRequiredThreatIds = affected.map((entry) => entry.id);
  const blockedThreatIds = affected
    .filter((entry) => entry.residualRisk === "high")
    .filter((entry) => !input.decisions.some((decision) =>
      decision.threatId === entry.id &&
      decision.owner.trim().length > 0 &&
      decision.rationale.trim().length >= 12 &&
      decision.acceptedAt <= input.now &&
      decision.expiresAt > input.now
    ))
    .map((entry) => entry.id);
  return {
    allowed: blockedThreatIds.length === 0,
    blockedThreatIds,
    reviewRequiredThreatIds
  };
}

export async function assertPathInsideProject(
  projectRoot: string,
  requestedPath: string
): Promise<string> {
  const canonicalRoot = await realpath(projectRoot);
  const canonicalRequested = await realpath(resolve(projectRoot, requestedPath));
  const relation = relative(canonicalRoot, canonicalRequested);
  if (relation === ".." || relation.startsWith(`..${separator()}`) || relation.startsWith("/")) {
    throw new SecurityBoundaryError(
      "path-escape",
      "The requested path resolves outside the registered project."
    );
  }
  return canonicalRequested;
}

export interface ApprovalReceipt {
  readonly effectId: string;
  readonly nonce: string;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly digest: string;
}

export function createApprovalReceipt(input: {
  readonly effectId: string;
  readonly nonce: string;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly policyDigest: string;
}): ApprovalReceipt {
  return {
    effectId: input.effectId,
    nonce: input.nonce,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
    digest: approvalDigest(input)
  };
}

export function verifyApprovalReceipt(input: {
  readonly receipt: ApprovalReceipt;
  readonly effectId: string;
  readonly policyDigest: string;
  readonly now: number;
  readonly consumedNonces: ReadonlySet<string>;
}): void {
  if (
    input.receipt.effectId !== input.effectId ||
    input.receipt.expiresAt <= input.now ||
    input.receipt.approvedAt > input.now ||
    input.consumedNonces.has(input.receipt.nonce) ||
    input.receipt.digest !== approvalDigest({
      effectId: input.receipt.effectId,
      nonce: input.receipt.nonce,
      approvedAt: input.receipt.approvedAt,
      expiresAt: input.receipt.expiresAt,
      policyDigest: input.policyDigest
    })
  ) {
    throw new SecurityBoundaryError(
      "approval-invalid",
      "Approval is expired, already used, or does not match this exact effect."
    );
  }
}

export function verifyUpdateArtifact(input: {
  readonly bytes: Uint8Array;
  readonly expectedSha256: string;
  readonly signed: boolean;
}): void {
  const digest = createHash("sha256").update(input.bytes).digest("hex");
  if (!input.signed || digest !== input.expectedSha256) {
    throw new SecurityBoundaryError(
      "update-untrusted",
      "The update signature or digest could not be verified."
    );
  }
}

export class SecurityBoundaryError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SecurityBoundaryError";
  }
}

function control(
  id: string,
  title: string,
  surfaces: readonly ThreatSurface[],
  severity: "high" | "critical",
  residualRisk: "low" | "medium" | "high"
): ThreatControl {
  return {
    id,
    title,
    surfaces,
    severity,
    prevention: "Deny by typed policy before the effect is created.",
    detection: "Record a privacy-safe denial or integrity event.",
    response: "Stop the affected scope, preserve evidence, and rotate impacted access.",
    verification: `Run the ${id} adversarial release test.`,
    owner: "Security maintainer",
    residualRisk
  };
}

function approvalDigest(input: {
  readonly effectId: string;
  readonly nonce: string;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly policyDigest: string;
}): string {
  return createHash("sha256")
    .update([
      input.effectId,
      input.nonce,
      input.approvedAt,
      input.expiresAt,
      input.policyDigest
    ].join("\u0000"))
    .digest("hex");
}

function separator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

