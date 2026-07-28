import {
  operationalMetricSchema,
  type OperationalMetric,
} from "../packages/schemas/src/index.js";

const scope = {
  projectId: "freeloader-coder",
  from: "2026-07-27T09:00:00.000Z",
  to: "2026-07-28T09:00:00.000Z",
};
const observedAt = "2026-07-28T08:58:00.000Z";

function metric(
  input: Omit<OperationalMetric, "schemaVersion" | "scope" | "provenance"> & {
    eventTypes: readonly string[];
    aggregation?: OperationalMetric["provenance"]["aggregation"];
    freshness?: OperationalMetric["provenance"]["freshness"];
    estimated?: boolean;
  }
): OperationalMetric {
  return operationalMetricSchema.parse({
    schemaVersion: 1,
    id: input.id,
    kind: input.kind,
    label: input.label,
    value: input.value,
    unit: input.unit,
    scope,
    provenance: {
      eventTypes: input.eventTypes,
      observedAt,
      freshness: input.freshness ?? "fresh",
      aggregation: input.aggregation ?? "count",
      estimated: input.estimated ?? false,
    },
  });
}

export const controlCenterMetrics: readonly OperationalMetric[] = [
  metric({ id: "throughput-24h", kind: "throughput", label: "Completed", value: 12, unit: "tasks", eventTypes: ["task.completed"] }),
  metric({ id: "stage-duration", kind: "stage_duration", label: "Median stage duration", value: 720_000, unit: "milliseconds", eventTypes: ["task.stage_started", "task.stage_completed"], aggregation: "duration" }),
  metric({ id: "queue-now", kind: "queue", label: "Queue", value: 8, unit: "tasks", eventTypes: ["task.queued", "task.claimed"], aggregation: "latest" }),
  metric({ id: "lease-now", kind: "active_leases", label: "Active work", value: 1, unit: "tasks", eventTypes: ["lease.acquired", "lease.released"], aggregation: "latest" }),
  metric({ id: "retries-24h", kind: "retries", label: "Retries", value: 3, unit: "count", eventTypes: ["task.retry_scheduled"] }),
  metric({ id: "provider-calls-24h", kind: "provider_calls", label: "Provider calls", value: 25, unit: "calls", eventTypes: ["provider.call_succeeded", "provider.call_failed"] }),
  metric({ id: "input-tokens-24h", kind: "input_tokens", label: "Input tokens", value: 153_000, unit: "tokens", eventTypes: ["provider.call_succeeded"], aggregation: "sum" }),
  metric({ id: "output-tokens-24h", kind: "output_tokens", label: "Output tokens", value: 26_500, unit: "tokens", eventTypes: ["provider.call_succeeded"], aggregation: "sum" }),
  metric({ id: "quota-now", kind: "quota_remaining", label: "Known quota remaining", value: null, unit: "percent", eventTypes: ["provider.quota_reported"], freshness: "missing", aggregation: "latest" }),
  metric({ id: "fallbacks-24h", kind: "fallbacks", label: "Fallbacks", value: 2, unit: "count", eventTypes: ["provider.fallback_selected"] }),
  metric({ id: "validations-24h", kind: "validations", label: "Verified", value: 12, unit: "tasks", eventTypes: ["validation.completed"] }),
  metric({ id: "reviews-24h", kind: "reviews", label: "Reviews", value: 8, unit: "count", eventTypes: ["review.completed"] }),
  metric({ id: "healing-24h", kind: "healing", label: "Healed", value: 3, unit: "count", eventTypes: ["healing.completed"] }),
  metric({ id: "needs-user-now", kind: "needs_user", label: "Needs you", value: 1, unit: "tasks", eventTypes: ["task.needs_user", "task.user_resolved"], aggregation: "latest" }),
  metric({ id: "quarantined-now", kind: "quarantined", label: "Quarantined", value: 0, unit: "tasks", eventTypes: ["task.quarantined", "task.quarantine_resolved"], aggregation: "latest" }),
  metric({ id: "recoveries-24h", kind: "recoveries", label: "Recoveries", value: 2, unit: "count", eventTypes: ["recovery.completed"] }),
];

export function controlCenterMetric(
  kind: OperationalMetric["kind"]
): OperationalMetric {
  const found = controlCenterMetrics.find((item) => item.kind === kind);
  if (!found) throw new Error(`Control Center fixture is missing ${kind}.`);
  return found;
}
