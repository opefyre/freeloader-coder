export type DeviceState =
  | "online"
  | "busy"
  | "slow"
  | "sleeping"
  | "disconnected"
  | "incompatible"
  | "updating"
  | "revoked";

export interface DeviceActivity {
  readonly deviceId: string;
  readonly state: DeviceState;
  readonly taskId: string | null;
  readonly stage: string | null;
  readonly activeRequest: boolean;
  readonly validationActive: boolean;
  readonly lastActivityAt: number | null;
  readonly leaseExpiresAt: number | null;
  readonly resourcePressure: "normal" | "memory" | "disk" | "thermal";
}

export function classifyDeviceActivity(input: {
  readonly activity: DeviceActivity;
  readonly now: number;
  readonly slowAfterMs: number;
  readonly stoppedAfterMs: number;
}): "healthy" | "slow_active" | "stopped" | "attention" {
  const activity = input.activity;
  if (["revoked", "incompatible"].includes(activity.state)) return "attention";
  if (activity.state === "sleeping" || activity.state === "disconnected") {
    return activity.taskId === null ? "attention" : "stopped";
  }
  if (activity.lastActivityAt === null) return activity.taskId === null ? "healthy" : "stopped";
  const silence = input.now - activity.lastActivityAt;
  if (silence <= input.slowAfterMs) return "healthy";
  if (
    silence <= input.stoppedAfterMs
    && (activity.activeRequest || activity.validationActive)
  ) {
    return "slow_active";
  }
  return "stopped";
}

export function safeDeviceAction(input: {
  readonly action: "drain" | "pause" | "revoke" | "repair" | "move_next_work";
  readonly activity: DeviceActivity;
}): {
  readonly allowed: boolean;
  readonly effect: string;
} {
  if (
    input.action === "repair"
    && (input.activity.activeRequest || input.activity.validationActive)
  ) {
    return {
      allowed: false,
      effect: "Wait for active model or validator work; unsafe restart is blocked."
    };
  }
  if (input.action === "revoke" && input.activity.taskId !== null) {
    return {
      allowed: false,
      effect: "Drain and reconcile active work before revoking credentials."
    };
  }
  const effects = {
    drain: "Finish the active lease and accept no new work.",
    pause: "Pause new assignments; preserve active evidence and checkpoints.",
    revoke: "Invalidate credentials and prevent new leases immediately.",
    repair: "Repair stopped services only after confirming no active request.",
    move_next_work: "Route future eligible work elsewhere; do not move the active lease."
  } as const;
  return { allowed: true, effect: effects[input.action] };
}

export function redactDeviceSupportExport(activity: DeviceActivity): Readonly<Record<string, unknown>> {
  return {
    deviceRef: `device:${activity.deviceId.slice(-6)}`,
    state: activity.state,
    taskRef: activity.taskId ? `task:${activity.taskId.slice(-6)}` : null,
    stage: activity.stage,
    activeRequest: activity.activeRequest,
    validationActive: activity.validationActive,
    leaseFresh: activity.leaseExpiresAt !== null,
    resourcePressure: activity.resourcePressure
  };
}
