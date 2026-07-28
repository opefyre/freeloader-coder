import { createHash } from "node:crypto";

export type GitHubPermission =
  | "identity:read"
  | "contents:read"
  | "contents:write"
  | "pull_requests:write"
  | "issues:read"
  | "actions:read"
  | "models:read";

export interface GitHubAccess {
  readonly accountId: string;
  readonly repositoryIds: readonly string[];
  readonly permissions: readonly GitHubPermission[];
  readonly modelsEnabled: boolean;
  readonly modelsAttribution: "personal" | `organization:${string}` | null;
}

export interface RepositoryCandidate {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly protectedBranches: readonly string[];
  readonly features: readonly ("lfs" | "submodules" | "large_files")[];
}

export function planRepositoryImport(input: {
  readonly access: GitHubAccess;
  readonly repository: RepositoryCandidate;
  readonly branch: string;
  readonly destination: string;
  readonly destinationState: "empty" | "existing_project" | "existing_unrelated";
  readonly localState: "clean" | "checkpoints" | "diverged";
}): {
  readonly action: "clone" | "refresh" | "guided_conflict" | "blocked";
  readonly preservesCheckpoints: boolean;
  readonly warnings: readonly string[];
  readonly nextAction: string;
} {
  assertRepositoryAccess(input.access, input.repository.id, "contents:read");
  if (!input.destination.startsWith("/") || input.destination.includes("\0")) {
    throw new Error("Repository destination must be an absolute local path.");
  }
  if (!input.branch.trim()) throw new Error("A repository branch is required.");
  const warnings = input.repository.features.map((feature) => {
    if (feature === "lfs") return "Git LFS content requires the local LFS helper.";
    if (feature === "submodules") return "Submodules remain separately permissioned repositories.";
    return "Large files will be checked against local disk capacity before clone.";
  });
  if (input.destinationState === "existing_unrelated") {
    return {
      action: "blocked",
      preservesCheckpoints: true,
      warnings,
      nextAction: "Choose an empty folder or explicitly select the existing project."
    };
  }
  if (input.localState === "diverged") {
    return {
      action: "guided_conflict",
      preservesCheckpoints: true,
      warnings,
      nextAction: "Review local and GitHub changes side by side before refresh."
    };
  }
  return {
    action: input.destinationState === "empty" ? "clone" : "refresh",
    preservesCheckpoints: true,
    warnings,
    nextAction: input.destinationState === "empty"
      ? "Clone into the approved empty folder."
      : "Create a checkpoint, fetch, and apply only conflict-free changes."
  };
}

export interface PublishReceipt {
  readonly idempotencyKey: string;
  readonly branchUrl: string;
  readonly commitUrl: string;
  readonly pullRequestUrl: string;
  readonly verifiedAt: number;
}

export function planCheckpointPublish(input: {
  readonly access: GitHubAccess;
  readonly repository: RepositoryCandidate;
  readonly checkpointDigest: string;
  readonly baseBranch: string;
  readonly proposedBranch: string;
  readonly changedFiles: readonly string[];
  readonly checksPassed: readonly string[];
  readonly approvalMode: "guided" | "balanced" | "autonomous";
  readonly approved: boolean;
  readonly existingReceipts: readonly PublishReceipt[];
}): {
  readonly state: "awaiting_approval" | "ready" | "already_verified";
  readonly idempotencyKey: string;
  readonly targetBranch: string;
  readonly externalEffects: readonly string[];
  readonly existingReceipt: PublishReceipt | null;
} {
  assertRepositoryAccess(input.access, input.repository.id, "contents:write");
  assertRepositoryAccess(input.access, input.repository.id, "pull_requests:write");
  if (!/^[a-f0-9]{64}$/.test(input.checkpointDigest)) {
    throw new Error("Checkpoint digest is invalid.");
  }
  if (input.changedFiles.length === 0 || input.checksPassed.length === 0) {
    throw new Error("Publishing requires changed files and observed validation evidence.");
  }
  const targetBranch = safeBranch(input.proposedBranch);
  const idempotencyKey = digest(
    `${input.repository.id}:${input.checkpointDigest}:${input.baseBranch}:${targetBranch}`
  );
  const existingReceipt = input.existingReceipts.find(
    (receipt) => receipt.idempotencyKey === idempotencyKey
  ) ?? null;
  if (existingReceipt) {
    return {
      state: "already_verified",
      idempotencyKey,
      targetBranch,
      externalEffects: [],
      existingReceipt
    };
  }
  const approvalRequired = input.approvalMode !== "autonomous";
  return {
    state: approvalRequired && !input.approved ? "awaiting_approval" : "ready",
    idempotencyKey,
    targetBranch,
    externalEffects: [
      `Create branch ${targetBranch}`,
      `Create one commit from checkpoint ${input.checkpointDigest.slice(0, 8)}`,
      `Open one pull request into ${input.baseBranch}`
    ],
    existingReceipt: null
  };
}

export function verifyPublishPostconditions(input: {
  readonly idempotencyKey: string;
  readonly expectedRepository: string;
  readonly branchUrl: string;
  readonly commitUrl: string;
  readonly pullRequestUrl: string;
  readonly observedOpenPullRequests: number;
  readonly now: number;
}): PublishReceipt {
  for (const url of [input.branchUrl, input.commitUrl, input.pullRequestUrl]) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      throw new Error("Publish postcondition points outside GitHub.");
    }
    if (!parsed.pathname.includes(`/${input.expectedRepository}/`)) {
      throw new Error("Publish postcondition points at the wrong repository.");
    }
  }
  if (input.observedOpenPullRequests !== 1) {
    throw new Error("Publish verification did not observe exactly one pull request.");
  }
  return {
    idempotencyKey: input.idempotencyKey,
    branchUrl: input.branchUrl,
    commitUrl: input.commitUrl,
    pullRequestUrl: input.pullRequestUrl,
    verifiedAt: input.now
  };
}

export function evaluateGitHubModels(input: {
  readonly access: GitHubAccess;
  readonly requestedModel: string;
  readonly allowedModels: readonly string[];
  readonly billingEnabled: boolean;
  readonly remainingRequests: number | null;
}): {
  readonly admitted: boolean;
  readonly reason: "ready" | "disabled" | "permission_missing" | "model_denied" | "billing_enabled" | "quota_unknown" | "quota_exhausted";
  readonly repositoryAccessChanged: false;
  readonly attribution: GitHubAccess["modelsAttribution"];
} {
  let reason: ReturnType<typeof evaluateGitHubModels>["reason"] = "ready";
  if (!input.access.modelsEnabled) reason = "disabled";
  else if (!input.access.permissions.includes("models:read")) reason = "permission_missing";
  else if (!input.allowedModels.includes(input.requestedModel)) reason = "model_denied";
  else if (input.billingEnabled) reason = "billing_enabled";
  else if (input.remainingRequests === null) reason = "quota_unknown";
  else if (input.remainingRequests <= 0) reason = "quota_exhausted";
  return {
    admitted: reason === "ready",
    reason,
    repositoryAccessChanged: false,
    attribution: input.access.modelsAttribution
  };
}

function assertRepositoryAccess(
  access: GitHubAccess,
  repositoryId: string,
  permission: GitHubPermission
): void {
  if (!access.repositoryIds.includes(repositoryId)) {
    throw new Error("Repository is outside the selected GitHub grant.");
  }
  if (!access.permissions.includes(permission)) {
    throw new Error(`GitHub permission ${permission} is required.`);
  }
}

function safeBranch(branch: string): string {
  const normalized = branch.trim();
  if (
    !normalized ||
    normalized.startsWith("-") ||
    normalized.includes("..") ||
    normalized.includes("~") ||
    normalized.includes("^") ||
    normalized.includes(":") ||
    normalized.includes("\\") ||
    normalized.endsWith("/")
  ) {
    throw new Error("Proposed branch name is unsafe.");
  }
  return normalized;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
