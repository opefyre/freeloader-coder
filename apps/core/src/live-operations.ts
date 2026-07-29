import { createHash } from "node:crypto";

import {
  liveOperationsSnapshotSchema,
  type LiveOperationsEvent,
  type LiveOperationsSnapshot,
} from "../../../packages/runtime/src/live-operations.js";
import type { LocalProjectCollection } from "../../../packages/runtime/src/local-projects.js";
import type {
  LocalRequest,
  LocalRequestCollection,
} from "../../../packages/runtime/src/local-requests.js";
import type {
  PublicProviderConnectionCollection,
} from "../../../packages/runtime/src/provider-connections.js";

const stages = [
  "needs_input",
  "queued",
  "approved",
  "claimed",
  "checkpointed",
  "completed",
  "interrupted",
  "cancelled",
] as const;

export function buildLiveOperationsSnapshot(input: {
  projects: LocalProjectCollection;
  requests: LocalRequestCollection;
  providers: PublicProviderConnectionCollection;
  now?: number;
}): LiveOperationsSnapshot {
  const observedAt = input.now ?? Date.now();
  const counts = new Map(stages.map((stage) => [stage, 0]));
  for (const request of input.requests.requests) {
    counts.set(request.state, (counts.get(request.state) ?? 0) + 1);
  }

  const active = input.requests.requests.filter((request) =>
    ["approved", "claimed", "checkpointed"].includes(request.state)
  ).length;
  const needsAttention =
    (counts.get("needs_input") ?? 0) +
    (counts.get("interrupted") ?? 0) +
    input.projects.projects.filter((project) => project.state !== "ready").length +
    input.providers.connections.filter((connection) =>
      connection.state !== "ready" || !connection.admission.admitted
    ).length;
  const readyProviders = input.providers.connections.filter((connection) =>
    connection.state === "ready" &&
    connection.admission.admitted &&
    connection.credentialState === "active" &&
    connection.cost.zeroCost &&
    !connection.cost.billingEnabled
  ).length;

  const recentEvents = [
    ...input.requests.requests.flatMap(requestEvents),
    ...input.projects.projects.map((project) => ({
      id: eventId(`project:${project.id}:${project.observedAt}:${project.state}`),
      kind: "project" as const,
      state: project.state,
      title: project.displayName,
      detail:
        project.state === "ready"
          ? "Project observation is ready."
          : project.warnings[0] ?? "Project needs attention.",
      observedAt: project.observedAt,
      projectId: project.id,
      requestId: null,
      providerId: null,
    })),
    ...input.providers.connections.map((connection) => ({
      id: eventId(`provider:${connection.id}:${connection.updatedAt}:${connection.state}`),
      kind: "provider" as const,
      state: connection.state,
      title: connection.providerLabel,
      detail: connection.admission.admitted
        ? `${connection.modelId} is admitted for zero-cost work.`
        : connection.admission.detail,
      observedAt: connection.updatedAt,
      projectId: null,
      requestId: null,
      providerId: connection.providerId,
    })),
  ]
    .sort((left, right) => right.observedAt - left.observedAt || left.id.localeCompare(right.id))
    .slice(0, 60);

  return liveOperationsSnapshotSchema.parse({
    schemaVersion: 1,
    provenance: "local_operational_aggregation",
    observedAt,
    validForMs: 15_000,
    automaticSpendLimitUsd: 0,
    health:
      needsAttention > 0
        ? "attention"
        : active > 0
          ? "healthy"
          : "idle",
    totals: {
      projects: input.projects.projects.length,
      requests: input.requests.requests.length,
      active,
      completed: counts.get("completed") ?? 0,
      needsAttention,
      providers: input.providers.connections.length,
      readyProviders,
    },
    stages: stages.map((stage) => ({ stage, count: counts.get(stage) ?? 0 })),
    providers: input.providers.connections.map((connection) => ({
      id: connection.id,
      providerId: connection.providerId,
      label: connection.providerLabel,
      modelId: connection.modelId,
      state: connection.state,
      admitted: connection.admission.admitted,
      zeroCost: connection.cost.zeroCost && !connection.cost.billingEnabled,
      updatedAt: connection.updatedAt,
    })),
    recentEvents,
  });
}

function requestEvents(request: LocalRequest): LiveOperationsEvent[] {
  const summary: LiveOperationsEvent = {
    id: eventId(`request:${request.id}:${request.updatedAt}:${request.state}`),
    kind: "request",
    state: request.state,
    title: boundedTitle(request.outcome),
    detail: requestDetail(request),
    observedAt: request.updatedAt,
    projectId: request.projectId,
    requestId: request.id,
    providerId:
      request.execution?.proposal?.generation?.selectedProviderId ?? null,
  };
  const durable = (request.run?.events ?? []).map((event) => ({
    id: eventId(`run:${request.id}:${event.sequence}:${event.type}`),
    kind: "request" as const,
    state: event.type,
    title: boundedTitle(request.outcome),
    detail: event.detail,
    observedAt: event.observedAt,
    projectId: request.projectId,
    requestId: request.id,
    providerId: null,
  }));
  return [summary, ...durable];
}

function boundedTitle(outcome: string): string {
  const compact = safeText(outcome).replace(/\s+/g, " ").trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}…`;
}

function requestDetail(request: LocalRequest): string {
  if (request.state === "needs_input") {
    return safeText(
      request.findings.find((finding) => finding.severity === "blocking")?.detail
        ?? "Request needs more input."
    );
  }
  const proposal = request.execution?.proposal;
  if (proposal?.safeMessage) return safeText(proposal.safeMessage);
  return `Request is ${request.state.replaceAll("_", " ")}.`;
}

function safeText(value: string): string {
  return value
    .replace(/\b(?:sk|gsk|AIza|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]");
}

function eventId(seed: string): string {
  return `event_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}
