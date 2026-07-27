export interface LeaseRecord {
  readonly taskId: string;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly expiresAt: number;
}

export interface EffectRecord {
  readonly idempotencyKey: string;
  readonly inputDigest: string;
  readonly status: "started" | "completed" | "outcome_unknown";
  readonly outputDigest?: string;
}

export interface CoordinationState {
  readonly leases: ReadonlyMap<string, LeaseRecord>;
  readonly effects: ReadonlyMap<string, EffectRecord>;
}

export function emptyCoordinationState(): CoordinationState {
  return { leases: new Map(), effects: new Map() };
}

export function claimLease(
  state: CoordinationState,
  lease: LeaseRecord,
  now: number
): CoordinationState {
  const current = state.leases.get(lease.taskId);
  if (current && current.expiresAt > now) throw new Error("Task has an active lease.");
  if (lease.expiresAt <= now) throw new Error("Lease must expire in the future.");
  return { ...state, leases: new Map(state.leases).set(lease.taskId, lease) };
}

export function releaseLease(
  state: CoordinationState,
  taskId: string,
  leaseId: string
): CoordinationState {
  const current = state.leases.get(taskId);
  if (!current || current.leaseId !== leaseId) throw new Error("Lease mismatch.");
  const leases = new Map(state.leases);
  leases.delete(taskId);
  return { ...state, leases };
}

export function beginEffect(
  state: CoordinationState,
  effect: Omit<EffectRecord, "status" | "outputDigest">
): { readonly state: CoordinationState; readonly execute: boolean } {
  const current = state.effects.get(effect.idempotencyKey);
  if (current) {
    if (current.inputDigest !== effect.inputDigest) throw new Error("Idempotency key reused with different input.");
    return { state, execute: false };
  }
  const record: EffectRecord = { ...effect, status: "started" };
  return {
    state: { ...state, effects: new Map(state.effects).set(effect.idempotencyKey, record) },
    execute: true
  };
}

export function completeEffect(
  state: CoordinationState,
  idempotencyKey: string,
  outputDigest: string
): CoordinationState {
  const current = state.effects.get(idempotencyKey);
  if (!current) throw new Error("Effect does not exist.");
  const completed: EffectRecord = { ...current, status: "completed", outputDigest };
  return { ...state, effects: new Map(state.effects).set(idempotencyKey, completed) };
}

export function reconcileInterruptedEffects(state: CoordinationState): CoordinationState {
  const effects = new Map(state.effects);
  for (const [key, effect] of effects) {
    if (effect.status === "started") effects.set(key, { ...effect, status: "outcome_unknown" });
  }
  return { ...state, effects };
}
