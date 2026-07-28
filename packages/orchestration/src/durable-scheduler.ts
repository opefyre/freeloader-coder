import {
  claimLease,
  type CoordinationState,
  type LeaseRecord
} from "../../storage/src/coordination.js";

export interface ScheduledTask {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly priority: number;
  readonly enqueuedAt: number;
  readonly status: "queued" | "running" | "completed" | "blocked";
  readonly revision: number;
}

export interface ActivityEvidence {
  readonly heartbeatAt: number | null;
  readonly modelActivityAt: number | null;
  readonly validationActivityAt: number | null;
  readonly toolActivityAt: number | null;
  readonly modelRequestActive: boolean;
  readonly validationActive: boolean;
  readonly expectedStageDurationMs: number;
}

export function eligibleTasks(
  tasks: readonly ScheduledTask[],
  coordination: CoordinationState,
  now: number
): readonly ScheduledTask[] {
  const completed = new Set(
    tasks.filter((task) => task.status === "completed").map((task) => task.id)
  );
  return tasks
    .filter((task) => task.status === "queued")
    .filter((task) => task.dependsOn.every((dependency) => completed.has(dependency)))
    .filter((task) => {
      const lease = coordination.leases.get(task.id);
      return !lease || lease.expiresAt <= now;
    })
    .sort((left, right) =>
      left.priority - right.priority
      || left.enqueuedAt - right.enqueuedAt
      || left.id.localeCompare(right.id)
    );
}

export function claimScheduledTask(input: {
  readonly tasks: readonly ScheduledTask[];
  readonly coordination: CoordinationState;
  readonly workerId: string;
  readonly now: number;
  readonly leaseMs: number;
}): {
  readonly task: ScheduledTask | null;
  readonly coordination: CoordinationState;
  readonly lease: LeaseRecord | null;
} {
  if (input.leaseMs < 1) throw new Error("Lease duration must be positive.");
  const task = eligibleTasks(input.tasks, input.coordination, input.now)[0] ?? null;
  if (!task) return { task: null, coordination: input.coordination, lease: null };
  const lease: LeaseRecord = {
    taskId: task.id,
    leaseId: `${task.id}.${input.workerId}.${input.now}`,
    ownerId: input.workerId,
    expiresAt: input.now + input.leaseMs
  };
  return {
    task,
    lease,
    coordination: claimLease(input.coordination, lease, input.now)
  };
}

export function renewTaskLease(input: {
  readonly coordination: CoordinationState;
  readonly taskId: string;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly now: number;
  readonly leaseMs: number;
}): CoordinationState {
  const current = input.coordination.leases.get(input.taskId);
  if (
    !current ||
    current.leaseId !== input.leaseId ||
    current.ownerId !== input.ownerId ||
    current.expiresAt <= input.now
  ) {
    throw new Error("Only the active lease owner can renew a task.");
  }
  const leases = new Map(input.coordination.leases);
  leases.set(input.taskId, { ...current, expiresAt: input.now + input.leaseMs });
  return { ...input.coordination, leases };
}

export function classifyTaskActivity(input: {
  readonly evidence: ActivityEvidence;
  readonly now: number;
  readonly minimumGraceMs: number;
  readonly maximumSilentMs: number;
  readonly expectedDurationMultiplier: number;
}): "active" | "slow" | "stalled" {
  const observed = [
    input.evidence.heartbeatAt,
    input.evidence.modelActivityAt,
    input.evidence.validationActivityAt,
    input.evidence.toolActivityAt
  ].filter((value): value is number => value !== null);
  if (observed.length === 0) return "stalled";
  const latest = Math.max(...observed);
  const silence = Math.max(0, input.now - latest);
  const healthyWindow = Math.max(
    input.minimumGraceMs,
    input.evidence.expectedStageDurationMs * input.expectedDurationMultiplier
  );
  if (silence <= healthyWindow) return "active";
  if (
    silence <= input.maximumSilentMs &&
    (input.evidence.modelRequestActive || input.evidence.validationActive)
  ) {
    return "slow";
  }
  return "stalled";
}

export function transitionScheduledTask(input: {
  readonly task: ScheduledTask;
  readonly coordination: CoordinationState;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly now: number;
  readonly expectedRevision: number;
  readonly nextStatus: ScheduledTask["status"];
}): ScheduledTask {
  const lease = input.coordination.leases.get(input.task.id);
  if (
    !lease ||
    lease.leaseId !== input.leaseId ||
    lease.ownerId !== input.ownerId ||
    lease.expiresAt <= input.now
  ) {
    throw new Error("Task transition requires the active lease owner.");
  }
  if (input.task.revision !== input.expectedRevision) {
    throw new Error("Task transition revision is stale.");
  }
  return {
    ...input.task,
    status: input.nextStatus,
    revision: input.task.revision + 1
  };
}
