export interface ServiceState {
  readonly id: string;
  readonly runningProcesses: number;
  readonly activeRequest: boolean;
  readonly liveLease: boolean;
  readonly crashCount: number;
  readonly lastCrashAt: number | null;
}

export function recoveryDecision(input: {
  readonly services: readonly ServiceState[];
  readonly failedServiceId: string;
  readonly now: number;
  readonly crashLoopLimit: number;
}): {
  readonly action: "restart_exact_service" | "wait_for_active_work" | "stop_crash_loop" | "needs_user";
  readonly serviceId: string;
  readonly evidence: readonly string[];
  readonly nextAttemptAt: number | null;
} {
  const service = input.services.find((item) => item.id === input.failedServiceId);
  if (!service) return { action: "needs_user", serviceId: input.failedServiceId, evidence: ["service-not-registered"], nextAttemptAt: null };
  if (service.runningProcesses > 1) return { action: "needs_user", serviceId: service.id, evidence: ["duplicate-processes"], nextAttemptAt: null };
  if (service.activeRequest || service.liveLease) return { action: "wait_for_active_work", serviceId: service.id, evidence: ["active-request-or-lease"], nextAttemptAt: input.now + 30_000 };
  if (service.crashCount >= input.crashLoopLimit) return { action: "stop_crash_loop", serviceId: service.id, evidence: ["crash-loop-evidence-preserved"], nextAttemptAt: null };
  return { action: "restart_exact_service", serviceId: service.id, evidence: ["no-duplicate", "no-active-request", "no-live-lease"], nextAttemptAt: input.now + Math.min(60_000, 1_000 * 2 ** service.crashCount) };
}
