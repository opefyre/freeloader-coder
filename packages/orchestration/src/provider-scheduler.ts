import {
  routeProviders,
  type ProviderCandidate,
  type RouteDecision,
  type RouteRequest
} from "../../providers/src/router.js";

export interface ProviderWorkItem {
  readonly id: string;
  readonly taskId: string;
  readonly workUnitId: string;
  readonly priority: number;
  readonly enqueuedAt: number;
  readonly candidates: readonly ProviderCandidate[];
  readonly request: RouteRequest;
}

export interface ProviderDispatch {
  readonly item: ProviderWorkItem;
  readonly candidate: ProviderCandidate;
  readonly route: RouteDecision;
}

export interface ProviderScheduledWait {
  readonly item: ProviderWorkItem;
  readonly route: RouteDecision;
  readonly retryAt: number;
  readonly reason: "provider-capacity" | "provider-concurrency";
}

export interface ProviderBlockedWork {
  readonly item: ProviderWorkItem;
  readonly route: RouteDecision;
}

export interface ProviderQueue {
  readonly providerId: string;
  readonly activeRequests: number;
  readonly safeConcurrency: number | null;
  readonly availableSlots: number | null;
  readonly itemIds: readonly string[];
}

export interface ProviderSchedule {
  readonly dispatches: readonly ProviderDispatch[];
  readonly waiting: readonly ProviderScheduledWait[];
  readonly blocked: readonly ProviderBlockedWork[];
  readonly queues: readonly ProviderQueue[];
  readonly nextWakeAt: number | null;
}

export function planProviderSchedule(
  items: readonly ProviderWorkItem[],
  options: { readonly now: number; readonly concurrencyPollMs?: number }
): ProviderSchedule {
  const concurrencyPollMs = options.concurrencyPollMs ?? 5_000;
  if (!Number.isFinite(concurrencyPollMs) || concurrencyPollMs < 1) {
    throw new Error("Provider scheduler concurrency poll must be positive.");
  }

  const ordered = [...items].sort(compareWork);
  const routed = ordered.map((item) => ({ item, route: routeProviders(item.candidates, item.request) }));
  const dispatchable = routed.filter(
    (entry): entry is typeof entry & { route: RouteDecision & { selected: ProviderCandidate } } =>
      entry.route.selected !== null
  );
  const providerGroups = new Map<string, typeof dispatchable>();

  for (const entry of dispatchable) {
    const providerId = entry.route.selected.providerId;
    providerGroups.set(providerId, [...(providerGroups.get(providerId) ?? []), entry]);
  }

  const dispatches: ProviderDispatch[] = [];
  const waiting: ProviderScheduledWait[] = [];
  const queues: ProviderQueue[] = [];

  for (const [providerId, entries] of [...providerGroups].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const candidate = entries[0]!.route.selected;
    const safeConcurrency = candidate.capacity.maxConcurrentRequests ?? null;
    const activeRequests = Math.max(0, candidate.usage.activeRequests ?? 0);
    const availableSlots = safeConcurrency === null
      ? null
      : Math.max(0, safeConcurrency - activeRequests);
    const dispatchCount = availableSlots === null ? entries.length : availableSlots;

    entries.forEach((entry, index) => {
      if (index < dispatchCount) {
        dispatches.push({
          item: entry.item,
          candidate: entry.route.selected,
          route: entry.route
        });
      } else {
        waiting.push({
          item: entry.item,
          route: entry.route,
          retryAt: options.now + concurrencyPollMs,
          reason: "provider-concurrency"
        });
      }
    });
    queues.push({
      providerId,
      activeRequests,
      safeConcurrency,
      availableSlots,
      itemIds: entries.map((entry) => entry.item.id)
    });
  }

  const capacityWaiting = routed
    .filter((entry) => entry.route.state === "waiting" && entry.route.nextEligibleAt !== null)
    .map((entry): ProviderScheduledWait => ({
      item: entry.item,
      route: entry.route,
      retryAt: entry.route.nextEligibleAt!,
      reason: "provider-capacity"
    }));
  waiting.push(...capacityWaiting);

  const blocked = routed
    .filter((entry) => entry.route.state === "blocked")
    .map((entry): ProviderBlockedWork => ({ item: entry.item, route: entry.route }));
  const wakeTimes = waiting.map((entry) => entry.retryAt).filter((retryAt) => retryAt > options.now);

  return {
    dispatches,
    waiting: waiting.sort((left, right) => left.retryAt - right.retryAt || compareWork(left.item, right.item)),
    blocked,
    queues,
    nextWakeAt: wakeTimes.length > 0 ? Math.min(...wakeTimes) : null
  };
}

function compareWork(left: ProviderWorkItem, right: ProviderWorkItem): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.enqueuedAt !== right.enqueuedAt) return left.enqueuedAt - right.enqueuedAt;
  return left.id.localeCompare(right.id);
}
