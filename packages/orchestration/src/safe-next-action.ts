import {
  autonomyRecommendationSchema,
  type AutonomyMode,
  type AutonomyRecommendation,
} from "../../runtime/src/autonomy.js";
import type { LocalRequest } from "../../runtime/src/local-requests.js";

export function planSafeNextAction(input: {
  request: LocalRequest;
  mode: AutonomyMode;
  paused: boolean;
  now?: number;
}): AutonomyRecommendation {
  const { request } = input;
  const base = {
    requestId: request.id,
    projectId: request.projectId,
    expectedUpdatedAt: request.updatedAt,
    maximumCostUsd: 0 as const,
  };
  const recommendation = (() => {
    if (["completed", "cancelled"].includes(request.state)) {
      return terminal(base, request.state === "completed" ? "Work is complete" : "Work was cancelled", `The request is ${request.state}.`);
    }
    if (request.state === "needs_input") {
      return boundary(base, "provide_input", "Input required", request.findings[0]?.detail ?? "Clarify the requested outcome.");
    }
    if (request.state === "interrupted") {
      return attention(base, "Review interrupted work", "Preserved work needs review before another effect is attempted.");
    }
    if (request.state === "queued") {
      return boundary(base, "approve_request", "Approve the request", "A person must approve the zero-cost request contract before automation can inspect the project.");
    }
    if (!request.grounding || !request.topology || !request.plan) {
      return safe(base, "ground_request", "Understand the project", "Read bounded guidance and topology to create a cited plan.", "local_read", input);
    }
    if (request.plan.state !== "approved") {
      return boundary(base, "approve_plan", "Approve the grounded plan", "The coordinator cannot approve its own scope, files, checks, or dependencies.");
    }
    if (request.state === "claimed") {
      if (request.run?.lease && request.run.lease.expiresAt <= (input.now ?? Date.now())) {
        return safe(base, "reconcile_expired_lease", "Reconcile the expired lease", "The lease expired; inspect preserved canonical state before any retry.", "local_read", input);
      }
      return safe(base, "checkpoint_lease", "Record the safe checkpoint", "The active zero-effect lease can record its observed checkpoint.", "none", input);
    }
    if (request.state === "checkpointed") {
      return safe(base, "release_lease", "Release the completed lease", "The checkpoint is recorded and the zero-effect proof lease can be released.", "none", input);
    }
    if (!request.execution) {
      return boundary(base, "authorize_execution", "Authorize isolated execution", "A person must authorize the exact plan digest and isolation profile before local writes.");
    }
    const execution = request.execution;
    if (execution.state === "authorized") {
      return safe(base, "prepare_execution", "Prepare the isolated workspace", "The approved authority permits bounded local workspace preparation.", "authorized_local_write", input);
    }
    if (execution.state === "preparing") {
      return waiting(base, "Workspace preparation is active", "The coordinator will re-evaluate after the current local operation finishes.", null);
    }
    if (execution.state === "ready" && !execution.run) {
      return safe(base, "start_execution", "Start deterministic execution", "The isolated workspace and exact authority are ready.", "authorized_local_write", input);
    }
    if (execution.state === "validating" && execution.run?.state === "ready") {
      return safe(base, "validate_execution", "Run deterministic validation", "The authorized isolated run is ready for its bounded validation command.", "authorized_local_write", input);
    }
    if (execution.state === "validating") {
      return waiting(base, "Validation is running", "Active deterministic validation remains healthy until it finishes or reaches its timeout.", null);
    }
    if (execution.state === "failed" || execution.state === "interrupted") {
      return safe(base, "reconcile_execution", "Reconcile preserved execution", "Read Git truth and preserved artifacts before proposing another effect.", "local_read", input);
    }
    if (execution.state === "blocked") {
      return attention(base, "Execution is blocked", "The preserved run needs a user decision before continuing.");
    }
    const proposal = execution.proposal;
    if (!proposal) {
      return boundary(base, "request_proposal", "Request a provider proposal", "Sending bounded project context to a configured provider requires an explicit request.");
    }
    if (proposal.state === "deferred") {
      return waiting(base, "Waiting for free provider capacity", proposal.safeMessage ?? "The free route is scheduled to retry later.", proposal.retryAt);
    }
    if (proposal.state === "generating") {
      return waiting(base, "Provider proposal is running", proposal.safeMessage ?? "The admitted free provider is producing a bounded proposal.", proposal.retryAt);
    }
    if (proposal.state === "needs_user" || proposal.state === "interrupted") {
      return attention(base, "Provider proposal needs attention", proposal.safeMessage ?? "Review preserved provider evidence.");
    }
    if (proposal.state === "review_ready") {
      return boundary(base, "accept_proposal", "Review the proposed change", "Provider output is untrusted until a person accepts the exact operations.");
    }
    if (!execution.changeSet && !execution.patch) {
      return boundary(base, "approve_change", "Approve the exact change", "Review the bounded paths, before-digests, content, and findings.");
    }
    if (!execution.commit) {
      return boundary(base, "approve_commit", "Approve the local commit", "A person must approve the exact commit preview and message.");
    }
    if (!execution.integration) {
      return boundary(base, "approve_integration", "Approve local integration", "A person must approve the exact source commit and target head.");
    }
    return terminal(base, "Review-ready work", "The implementation is preserved with its local evidence.");
  })();
  return autonomyRecommendationSchema.parse(recommendation);
}

function safe(base: Base, action: AutonomyRecommendation["action"], title: string, reason: string, effect: AutonomyRecommendation["effect"], input: { mode: AutonomyMode; paused: boolean }) {
  return { ...base, classification: "safe_action" as const, action, boundary: "none" as const, title, reason, effect, automaticAllowed: input.mode === "autonomous" && !input.paused, retryAt: null, evidence: ["Canonical request revision", "Existing approval and policy state", "Zero-dollar automatic spend limit"] };
}
function boundary(base: Base, boundaryValue: Exclude<AutonomyRecommendation["boundary"], "none">, title: string, reason: string) {
  return { ...base, classification: "approval" as const, action: null, boundary: boundaryValue, title, reason, effect: "none" as const, automaticAllowed: false, retryAt: null, evidence: ["Canonical request revision", "Human authority is not delegated to the coordinator"] };
}
function attention(base: Base, title: string, reason: string) {
  return { ...base, classification: "attention" as const, action: null, boundary: "review_failure" as const, title, reason, effect: "none" as const, automaticAllowed: false, retryAt: null, evidence: ["Canonical request revision", "Preserved failure evidence requires a user decision"] };
}
function waiting(base: Base, title: string, reason: string, retryAt: number | null) {
  return { ...base, classification: "waiting" as const, action: null, boundary: "none" as const, title, reason, effect: "none" as const, automaticAllowed: false, retryAt, evidence: ["Canonical request revision", retryAt === null ? "Active operation evidence" : "Provider retry schedule"] };
}
function terminal(base: Base, title: string, reason: string) {
  return { ...base, classification: "terminal" as const, action: null, boundary: "none" as const, title, reason, effect: "none" as const, automaticAllowed: false, retryAt: null, evidence: ["Canonical terminal request state"] };
}
type Base = Pick<AutonomyRecommendation, "requestId" | "projectId" | "expectedUpdatedAt" | "maximumCostUsd">;
