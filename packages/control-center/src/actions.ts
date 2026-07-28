export type TaskControlAction = "pause" | "resume" | "retry" | "repair" | "reprioritize" | "escalate";
export type ControllableState = "queued" | "running" | "paused" | "failed" | "needs_user" | "quarantined" | "completed";

export interface ControlPreview {
  readonly action: TaskControlAction;
  readonly allowed: boolean;
  readonly blocker: string | null;
  readonly smallestDecision: string | null;
  readonly activeLease: string | null;
  readonly preservedWork: readonly string[];
  readonly affectedDependencies: readonly string[];
  readonly cost: "zero";
  readonly approvalRequired: boolean;
}

const allowedByState: Record<ControllableState, readonly TaskControlAction[]> = {
  queued: ["pause", "reprioritize", "escalate"],
  running: ["pause", "escalate"],
  paused: ["resume", "reprioritize", "escalate"],
  failed: ["retry", "repair", "escalate"],
  needs_user: ["escalate"],
  quarantined: ["escalate"],
  completed: [],
};

export function previewTaskAction(input: {
  readonly action: TaskControlAction;
  readonly state: ControllableState;
  readonly activeLease: string | null;
  readonly preservedWork: readonly string[];
  readonly affectedDependencies: readonly string[];
}): ControlPreview {
  const allowed = allowedByState[input.state].includes(input.action);
  const quarantine = input.state === "quarantined";
  return {
    action: input.action,
    allowed,
    blocker: allowed ? null : quarantine
      ? "Quarantined work requires explicit evidence review."
      : `${input.action} is not valid while the task is ${input.state}.`,
    smallestDecision: allowed ? null : quarantine
      ? "Review the quarantine evidence and choose repair, abandon, or create replacement work."
      : "Choose an action available for the current canonical state.",
    activeLease: input.activeLease,
    preservedWork: [...input.preservedWork],
    affectedDependencies: [...input.affectedDependencies],
    cost: "zero",
    approvalRequired: quarantine || input.action === "retry" || input.action === "repair",
  };
}

export function applyTaskAction(input: {
  readonly preview: ControlPreview;
  readonly actor: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly appliedKeys: ReadonlySet<string>;
}): {
  readonly applied: boolean;
  readonly audit: { readonly actor: string; readonly reason: string; readonly effect: string; readonly postcondition: string };
} {
  if (!input.preview.allowed) throw new Error(input.preview.blocker ?? "Action is blocked.");
  if (!input.actor.trim() || !input.reason.trim() || !input.idempotencyKey.trim()) {
    throw new Error("Control action requires actor, reason, and idempotency.");
  }
  const duplicate = input.appliedKeys.has(input.idempotencyKey);
  return {
    applied: !duplicate,
    audit: {
      actor: input.actor,
      reason: input.reason,
      effect: duplicate ? "No duplicate effect" : input.preview.action,
      postcondition: duplicate ? "Existing result preserved" : `Task action ${input.preview.action} recorded`,
    },
  };
}
