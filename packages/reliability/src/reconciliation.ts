export type InterruptionKind = "sleep" | "restart" | "offline" | "quota" | "credential" | "worker" | "environment";

export function reconcileInterruption(input: {
  readonly kind: InterruptionKind;
  readonly checkpointValid: boolean;
  readonly partialWriteDetected: boolean;
  readonly completedEffectKeys: ReadonlySet<string>;
  readonly pendingEffectKey: string | null;
  readonly quotaResetAt: number | null;
}): {
  readonly preserved: readonly string[];
  readonly resume: "automatic" | "scheduled" | "needs_user" | "read_only_recovery";
  readonly nextAttemptAt: number | null;
  readonly repeatExternalEffect: boolean;
} {
  if (input.partialWriteDetected || !input.checkpointValid) {
    return { preserved: ["last-valid-checkpoint", "audit", "artifacts"], resume: "read_only_recovery", nextAttemptAt: null, repeatExternalEffect: false };
  }
  if (input.pendingEffectKey && input.completedEffectKeys.has(input.pendingEffectKey)) {
    return { preserved: ["checkpoint", "completed-effect"], resume: "automatic", nextAttemptAt: null, repeatExternalEffect: false };
  }
  if (input.kind === "quota") {
    return { preserved: ["checkpoint", "lease-released"], resume: input.quotaResetAt ? "scheduled" : "needs_user", nextAttemptAt: input.quotaResetAt, repeatExternalEffect: false };
  }
  if (["credential", "environment"].includes(input.kind)) {
    return { preserved: ["checkpoint", "worktree", "evidence"], resume: "needs_user", nextAttemptAt: null, repeatExternalEffect: false };
  }
  return { preserved: ["checkpoint", "worktree", "evidence"], resume: "automatic", nextAttemptAt: null, repeatExternalEffect: false };
}
