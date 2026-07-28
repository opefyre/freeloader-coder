export type StuckReason =
  | "active_slow" | "long_validation" | "dependency_blocked" | "paused" | "quota_wait"
  | "missing_lease" | "stale_lease" | "stopped_service" | "missing_runtime"
  | "missing_permission" | "repeated_failure";

export function planStuckRecovery(input: {
  readonly reason: StuckReason;
  readonly activeRequest: boolean;
  readonly validationActive: boolean;
  readonly claimable: boolean;
  readonly workerHealthy: boolean;
  readonly retryBudgetRemaining: number;
}): {
  readonly state: "healthy_slow" | "waiting" | "recover" | "needs_user" | "quarantined";
  readonly action: string;
  readonly preserved: readonly string[];
} {
  if (input.activeRequest || input.validationActive || ["active_slow", "long_validation"].includes(input.reason)) {
    return { state: "healthy_slow", action: "Keep observing real activity.", preserved: ["lease", "worktree", "evidence"] };
  }
  if (input.reason === "dependency_blocked" || input.reason === "paused" || input.reason === "quota_wait") {
    return { state: "waiting", action: input.reason === "quota_wait" ? "Wake at quota reset." : "Wait for the canonical unblock event.", preserved: ["checkpoint"] };
  }
  if (input.reason === "repeated_failure" && input.retryBudgetRemaining <= 0) {
    return { state: "quarantined", action: "Review evidence and choose repair, replace, or abandon.", preserved: ["branch", "artifacts", "reviews"] };
  }
  if (input.claimable && !input.workerHealthy) {
    return { state: "recover", action: "Verify duplicates and leases, then restart only the worker.", preserved: ["queue", "dependencies"] };
  }
  return { state: "needs_user", action: "Complete the missing runtime or permission setup, verify it, then Resume.", preserved: ["checkpoint", "worktree", "evidence"] };
}
