export interface ProviderCallEvent {
  readonly id: string;
  readonly providerId: string;
  readonly locality: "external" | "local";
  readonly occurredAt: string;
  readonly outcome: "succeeded" | "failed";
}

export interface ProviderShare {
  readonly providerId: string;
  readonly locality: "external" | "local";
  readonly calls: number;
  readonly share: number;
}

export function providerExecutionShare(input: {
  readonly events: readonly ProviderCallEvent[];
  readonly from: string;
  readonly to: string;
}): readonly ProviderShare[] {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error("Provider metric range is invalid.");
  const events = input.events.filter((event) => {
    const at = Date.parse(event.occurredAt);
    return at >= from && at < to;
  });
  const counts = new Map<string, { providerId: string; locality: "external" | "local"; calls: number }>();
  for (const event of events) {
    if (!event.providerId.trim()) throw new Error("Provider identity is required.");
    const key = `${event.locality}:${event.providerId}`;
    const current = counts.get(key) ?? { providerId: event.providerId, locality: event.locality, calls: 0 };
    counts.set(key, { ...current, calls: current.calls + 1 });
  }
  const total = events.length;
  return [...counts.values()]
    .map((item) => ({ ...item, share: total === 0 ? 0 : item.calls / total }))
    .sort((left, right) => right.calls - left.calls || left.providerId.localeCompare(right.providerId));
}

export function freshnessState(input: {
  readonly observedAt: string | null;
  readonly now: string;
  readonly staleAfterMs: number;
}): "fresh" | "stale" | "missing" {
  if (input.observedAt === null) return "missing";
  const age = Date.parse(input.now) - Date.parse(input.observedAt);
  if (!Number.isFinite(age) || age < 0 || input.staleAfterMs < 1) throw new Error("Freshness evidence is invalid.");
  return age > input.staleAfterMs ? "stale" : "fresh";
}
