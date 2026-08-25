import { createHash } from "node:crypto";

import {
  decisionQuerySchema,
  decisionSnapshotSchema,
  type DecisionAge,
  type DecisionCategory,
  type DecisionItem,
  type DecisionPriority,
  type DecisionQuery,
  type DecisionSnapshot,
} from "../../../packages/runtime/src/decisions.js";
import type { AutonomySnapshot } from "../../../packages/runtime/src/autonomy.js";
import type { LiveOperationsSnapshot } from "../../../packages/runtime/src/live-operations.js";
import type { ProjectLifecycleRecord } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectExecutionRecord } from "../../../packages/orchestration/src/project-execution.js";

const priorityWeight: Record<DecisionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function buildDecisionSnapshot(input: {
  live: LiveOperationsSnapshot;
  autonomy: AutonomySnapshot;
  lifecycles?: readonly ProjectLifecycleRecord[];
  executions?: readonly ProjectExecutionRecord[];
  query?: Partial<DecisionQuery>;
  now?: number;
}): DecisionSnapshot {
  const now = input.now ?? Date.now();
  const query = decisionQuerySchema.parse(input.query ?? {});
  const canonical = deduplicate([
    ...input.live.recentEvents.flatMap((event) => fromLiveEvent(event, now)),
    ...input.live.providers.flatMap((provider) => fromProvider(provider, now)),
    ...input.autonomy.recommendations.flatMap((recommendation) => supersededByLifecycle(recommendation, input.lifecycles ?? []) ? [] : fromRecommendation(recommendation, now)),
    ...(input.lifecycles ?? []).flatMap((lifecycle) => fromLifecycle(lifecycle, now)),
    ...(input.executions ?? []).flatMap((execution) => fromExecution(execution, now)),
    ...input.autonomy.leases.filter((lease) => lease.expiresAt <= now).map((lease) => decision({
      seed: `lease:${lease.requestId}:${lease.expiresAt}`,
      category: "recovery",
      priority: "critical",
      owner: "system",
      state: "expired",
      title: "Reconcile an expired coordinator lease",
      reason: "The bounded safe-step lease expired. Canonical reconciliation is required before another worker can proceed.",
      nextAction: "Review and reconcile the interrupted work",
      authorityBoundary: "review_failure",
      effect: "local_read",
      reversible: true,
      observedAt: lease.expiresAt,
      deadlineAt: lease.expiresAt,
      retryAt: null,
      projectId: projectForRequest(input.autonomy, lease.requestId),
      requestId: lease.requestId,
      providerId: null,
      source: "autonomy_lease",
      sourceRecordId: lease.requestId,
      evidence: ["Expired coordinator lease", "Canonical request state"],
      reference: workReference(lease.requestId),
    }, now)),
    ...input.autonomy.receipts.filter((receipt) => receipt.outcome === "failed" || receipt.outcome === "blocked").map((receipt) => decision({
      seed: `receipt:${receipt.id}:${receipt.outcome}:${receipt.completedAt}`,
      category: receipt.action.includes("reconcile") ? "recovery" : "failure",
      priority: receipt.outcome === "failed" ? "high" : "medium",
      owner: "user",
      state: "open",
      title: `${readable(receipt.action)} ${receipt.outcome}`,
      reason: receipt.detail,
      nextAction: "Inspect the failed safe step",
      authorityBoundary: "review_failure",
      effect: "none",
      reversible: true,
      observedAt: receipt.completedAt,
      deadlineAt: null,
      retryAt: null,
      projectId: receipt.projectId,
      requestId: receipt.requestId,
      providerId: null,
      source: "autonomy_receipt",
      sourceRecordId: receipt.id,
      evidence: ["Coordinator receipt", "Canonical request revision"],
      reference: workReference(receipt.requestId),
    }, now)),
  ]).sort((left, right) =>
    priorityWeight[left.priority] - priorityWeight[right.priority] ||
    Number(left.age !== "overdue") - Number(right.age !== "overdue") ||
    right.observedAt - left.observedAt ||
    left.id.localeCompare(right.id)
  ).slice(0, 250);
  const ranged = canonical.filter((item) => inRange(item.observedAt, query.range, now));
  const facets = {
    categories: facet(ranged, (item) => item.category),
    priorities: facet(ranged, (item) => item.priority),
    owners: facet(ranged, (item) => item.owner),
    ages: facet(ranged, (item) => item.age),
    projects: facet(ranged.filter((item) => item.projectId), (item) => item.projectId ?? ""),
    providers: facet(ranged.filter((item) => item.providerId), (item) => item.providerId ?? ""),
  };
  const needle = normalize(query.search);
  const items = ranged.filter((item) =>
    (query.categories.length === 0 || query.categories.includes(item.category)) &&
    (query.priorities.length === 0 || query.priorities.includes(item.priority)) &&
    (query.owners.length === 0 || query.owners.includes(item.owner)) &&
    (query.ages.length === 0 || query.ages.includes(item.age)) &&
    (!query.projectId || item.projectId === query.projectId) &&
    (!query.providerId || item.providerId === query.providerId) &&
    (!needle || normalize(`${item.title} ${item.reason} ${item.nextAction} ${item.category} ${item.providerId ?? ""}`).includes(needle))
  );
  return decisionSnapshotSchema.parse({
    schemaVersion: 1,
    provenance: "local_decision_inbox",
    observedAt: now,
    validForMs: 15_000,
    automaticSpendLimitUsd: 0,
    query,
    summary: {
      open: items.length,
      critical: items.filter((item) => item.priority === "critical").length,
      overdue: items.filter((item) => item.age === "overdue").length,
      approvals: items.filter((item) => item.category === "approval").length,
      blockedProjects: new Set(items.filter((item) => item.projectId).map((item) => item.projectId)).size,
      providerWaits: items.filter((item) => item.category === "provider").length,
      oldestObservedAt: items.length ? Math.min(...items.map((item) => item.observedAt)) : null,
    },
    facets,
    retention: {
      bounded: true,
      maximumItems: 250,
      completeness: "bounded_current_state",
      earliestObservedAt: canonical.length ? Math.min(...canonical.map((item) => item.observedAt)) : null,
    },
    items,
  });
}

function fromExecution(record: ProjectExecutionRecord, now: number): DecisionItem[] {
  return record.tasks.filter((task) => task.status === "needs_user" || task.status === "quarantined").map((task) => {
    const blocker = executionBlocker(task);
    return decision({
    seed: `execution:${record.projectId}:${task.id}:${task.revision}:${task.status}`,
    category: task.status === "quarantined" ? "failure" : "recovery",
    priority: task.status === "quarantined" ? "critical" : "high",
    owner: "user",
    state: task.status === "quarantined" ? "unavailable" : "open",
    title: `${task.jiraIssueKey} · ${blocker.title}`,
    reason: task.safeMessage,
    nextAction: blocker.nextAction,
    authorityBoundary: task.status === "quarantined" ? "review_quarantine" : "review_execution_failure",
    effect: "local_read",
    reversible: true,
    observedAt: task.updatedAt,
    deadlineAt: null,
    retryAt: null,
    projectId: record.projectId,
    requestId: null,
    providerId: task.assignment?.providerId ?? null,
    source: "system_observation",
    sourceRecordId: `${record.projectId}:${task.id}`,
    evidence: [`Blocker code: ${blocker.code}`, `Jira issue ${task.jiraIssueKey}`, `Execution revision ${task.revision}`, `${task.implementationEvidence.length} implementation evidence record(s)`, `${task.validations.length} validation record(s)`],
    reference: { surface: "projects", path: `/projects?project=${encodeURIComponent(record.projectId)}`, label: "Open project" },
  }, now);
  });
}

function executionBlocker(task: ProjectExecutionRecord["tasks"][number]) {
  if (/live journey|owner-facing completion/i.test(task.safeMessage)) return { code: "live_journey_incomplete", title: "Live journey proof required", nextAction: "Run the owner journey against the exact integrated revision, then retry completion" };
  if (/environment|ENOENT|npm ci|dependency/i.test(task.safeMessage)) return { code: "execution_environment_unavailable", title: "Execution environment needs repair", nextAction: "Repair the local project environment, verify it, then resume the bounded task" };
  if (/provider|free route|capacity/i.test(task.safeMessage)) return { code: "free_provider_unavailable", title: "Free provider unavailable", nextAction: "Wait for a verified free route or retry when free capacity returns" };
  if (task.status === "quarantined") return { code: "execution_quarantined", title: "Verified evidence is quarantined", nextAction: "Review the quarantined evidence and choose a bounded recovery" };
  return { code: "execution_needs_owner", title: "Execution needs a decision", nextAction: "Review the evidence and choose an available safe recovery" };
}

function supersededByLifecycle(recommendation: AutonomySnapshot["recommendations"][number], lifecycles: readonly ProjectLifecycleRecord[]): boolean {
  if (!recommendation.projectId || !["approve_request", "provide_input"].includes(recommendation.boundary)) return false;
  const lifecycle = lifecycles.find((item) => item.projectId === recommendation.projectId);
  return lifecycle ? !["intake", "context", "clarification"].includes(lifecycle.stage) : false;
}

function fromLifecycle(record: ProjectLifecycleRecord, now: number): DecisionItem[] {
  if (record.stage === "awaiting_design_approval") {
    const solution = record.artifacts.find((artifact) => artifact.kind === "solution");
    if (!solution) return [];
    return [decision({
      seed: `solution:${record.projectId}:${record.revision}:${solution.digest}`,
      category: "approval", priority: "high", owner: "user", state: "open",
      title: "Review the proposed solution", reason: "Product and technical review passed. Delivery planning remains blocked until the owner decides.",
      nextAction: "Review, approve, request changes, or decline", authorityBoundary: "approve_solution", effect: "authorized_local_write", reversible: false,
      observedAt: record.updatedAt, deadlineAt: null, retryAt: null, projectId: record.projectId, requestId: null, providerId: null,
      source: "project_solution", sourceRecordId: solution.digest,
      evidence: [`Solution revision ${solution.revision}`, `${solution.citations.length} cited sources`, `${solution.reviewerIds.length} independent reviewers`, `Digest: ${solution.digest.slice(0, 12)}`],
      reference: { surface: "decisions", path: `/decisions?project=${encodeURIComponent(record.projectId)}`, label: "Review solution" },
    }, now)];
  }
  if (record.stage !== "clarification" || record.questions.length === 0) return [];
  return record.questions.map((question) => decision({
    seed: `clarification:${record.projectId}:${record.revision}:${question.id}`,
    category: "input",
    priority: "medium",
    owner: "user",
    state: "open",
    title: question.prompt,
    reason: question.whyItMatters,
    nextAction: "Choose an answer in Build",
    authorityBoundary: "provide_input",
    effect: "none",
    reversible: true,
    observedAt: record.updatedAt,
    deadlineAt: null,
    retryAt: null,
    projectId: record.projectId,
    requestId: null,
    providerId: null,
    source: "project_clarification",
    sourceRecordId: question.id,
    evidence: [`${question.options.length} selectable options`, ...question.sourceFindingIds.slice(0, 8).map((id) => `Finding: ${id}`)],
    reference: { surface: "work", path: `/work?project=${encodeURIComponent(record.projectId)}`, label: "Review in Build" },
  }, now));
}

function fromLiveEvent(event: LiveOperationsSnapshot["recentEvents"][number], now: number): DecisionItem[] {
  const state = event.state.toLowerCase();
  const category = liveCategory(state, event.kind);
  if (!category) return [];
  const requestReference = event.requestId ? workReference(event.requestId) : null;
  const reference = requestReference ?? (event.kind === "project"
    ? { surface: "projects" as const, path: `/projects${event.projectId ? `?project=${encodeURIComponent(event.projectId)}` : ""}`, label: "Open project" }
    : event.kind === "provider"
      ? { surface: "providers" as const, path: `/providers${event.providerId ? `?provider=${encodeURIComponent(event.providerId)}` : ""}`, label: "Open provider" }
      : { surface: "activity" as const, path: "/activity", label: "Inspect activity" });
  const owner = category === "provider" ? "provider" : category === "recovery" ? "system" : "user";
  return [decision({
    seed: `live:${event.id}:${event.state}:${event.observedAt}`,
    category,
    priority: priorityFor(category, state, event.observedAt, null, now),
    owner,
    state: category === "provider" ? "waiting" : "open",
    title: event.title,
    reason: event.detail,
    nextAction: actionFor(category),
    authorityBoundary: boundaryFor(category),
    effect: "none",
    reversible: true,
    observedAt: event.observedAt,
    deadlineAt: null,
    retryAt: null,
    projectId: event.projectId,
    requestId: event.requestId,
    providerId: event.providerId,
    source: event.kind === "request" ? "live_request" : event.kind === "project" ? "project_observation" : event.kind === "provider" ? "provider_connection" : "system_observation",
    sourceRecordId: event.id,
    evidence: ["Canonical live operation", `${readable(event.kind)} state: ${readable(event.state)}`],
    reference,
  }, now)];
}

function fromProvider(provider: LiveOperationsSnapshot["providers"][number], now: number): DecisionItem[] {
  if (provider.state === "ready" && provider.admitted && provider.zeroCost) return [];
  return [decision({
    seed: `provider:${provider.id}:${provider.state}:${provider.updatedAt}`,
    category: "provider",
    priority: provider.state === "revoked" ? "high" : provider.state === "stale" ? "medium" : "low",
    owner: provider.state === "limited" ? "provider" : "user",
    state: provider.state === "revoked" ? "unavailable" : "waiting",
    title: `${provider.label} is ${provider.state}`,
    reason: provider.state === "revoked" ? "The local connection is revoked and cannot receive work." : provider.state === "stale" ? "Provider readiness evidence is stale and must be refreshed." : "The free provider currently has limited capacity.",
    nextAction: provider.state === "revoked" ? "Review provider connection" : "Inspect provider availability",
    authorityBoundary: provider.state === "revoked" ? "connect_provider" : "wait_for_provider",
    effect: "provider_request",
    reversible: true,
    observedAt: provider.updatedAt,
    deadlineAt: null,
    retryAt: null,
    projectId: null,
    requestId: null,
    providerId: provider.providerId,
    source: "provider_connection",
    sourceRecordId: provider.id,
    evidence: ["Provider connection observation", `$0 route: ${provider.zeroCost ? "yes" : "no"}`],
    reference: { surface: "providers", path: `/providers?provider=${encodeURIComponent(provider.providerId)}`, label: "Open provider" },
  }, now)];
}

function fromRecommendation(item: AutonomySnapshot["recommendations"][number], now: number): DecisionItem[] {
  if (item.classification === "terminal" || (item.classification === "safe_action" && item.automaticAllowed)) return [];
  const category: DecisionCategory = item.classification === "approval"
    ? (item.boundary === "provide_input" || item.boundary === "approve_request" ? "input" : "approval")
    : item.classification === "waiting" ? "provider"
      : item.classification === "attention" ? "failure" : "policy";
  const owner = item.classification === "waiting" ? "provider" : "user";
  return [decision({
    seed: `recommendation:${item.requestId}:${item.expectedUpdatedAt}:${item.classification}:${item.boundary}`,
    category,
    priority: priorityFor(category, item.classification, item.expectedUpdatedAt, item.retryAt, now),
    owner,
    state: item.classification === "waiting" ? "waiting" : "open",
    title: item.title,
    reason: item.reason,
    nextAction: actionFor(category),
    authorityBoundary: readable(item.boundary),
    effect: item.effect,
    reversible: true,
    observedAt: item.expectedUpdatedAt,
    deadlineAt: item.retryAt,
    retryAt: item.retryAt,
    projectId: item.projectId,
    requestId: item.requestId,
    providerId: null,
    source: "autonomy_recommendation",
    sourceRecordId: item.requestId,
    evidence: item.evidence,
    reference: workReference(item.requestId),
  }, now)];
}

function decision(input: Omit<DecisionItem, "id" | "age" | "maximumCostUsd"> & { seed: string }, now: number): DecisionItem {
  const { seed, ...item } = input;
  return {
    id: `decision_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`,
    ...item,
    title: safeText(item.title, 160),
    reason: safeText(item.reason, 400),
    nextAction: safeText(item.nextAction, 160),
    evidence: item.evidence.map((entry) => safeText(entry, 240)),
    maximumCostUsd: 0,
    age: ageFor(item.observedAt, item.deadlineAt, now),
  };
}

function liveCategory(state: string, kind: string): DecisionCategory | null {
  if (/(needs_input|input_required)/.test(state)) return "input";
  if (/(approval|authorize|permission)/.test(state)) return "approval";
  if (/(failed|error|interrupted|rejected|cancelled|corrupt)/.test(state)) return "failure";
  if (/(expired|reconcile|outcome_unknown)/.test(state)) return "recovery";
  if (kind === "provider" && /(limited|stale|revoked|unavailable|quota)/.test(state)) return "provider";
  if (kind === "project" && /(warning|blocked|missing|denied|unavailable)/.test(state)) return "project";
  if (kind === "system" && /(conflict|duplicate)/.test(state)) return "conflict";
  if (/(blocked|needs_attention|stale)/.test(state)) return "policy";
  return null;
}

function priorityFor(category: DecisionCategory, state: string, observedAt: number, deadlineAt: number | null, now: number): DecisionPriority {
  if (/(corrupt|security|credential|data_loss|outcome_unknown)/.test(state) || (deadlineAt !== null && deadlineAt <= now)) return "critical";
  if (category === "failure" || category === "recovery" || category === "conflict") return "high";
  if (category === "approval" || category === "input" || now - observedAt >= 24 * 60 * 60_000) return "medium";
  return "low";
}

function ageFor(observedAt: number, deadlineAt: number | null, now: number): DecisionAge {
  if (deadlineAt !== null && deadlineAt <= now) return "overdue";
  const age = Math.max(0, now - observedAt);
  return age < 15 * 60_000 ? "new" : age < 24 * 60 * 60_000 ? "recent" : age < 7 * 24 * 60 * 60_000 ? "aging" : "overdue";
}

function actionFor(category: DecisionCategory): string {
  if (category === "approval") return "Review the exact approval facts";
  if (category === "input") return "Provide the missing project input";
  if (category === "provider") return "Review provider availability";
  if (category === "project") return "Review project readiness";
  if (category === "recovery") return "Review recovery evidence";
  if (category === "conflict") return "Resolve the conflicting state";
  if (category === "policy") return "Review the policy boundary";
  return "Inspect failure evidence";
}

function boundaryFor(category: DecisionCategory): string {
  if (category === "approval") return "explicit_user_approval";
  if (category === "input") return "provide_input";
  if (category === "provider") return "provider_availability";
  if (category === "project") return "project_readiness";
  if (category === "recovery" || category === "failure") return "review_failure";
  return "review_required";
}

function projectForRequest(snapshot: AutonomySnapshot, requestId: string): string | null {
  return snapshot.recommendations.find((item) => item.requestId === requestId)?.projectId
    ?? snapshot.overrides.find((item) => item.requestId === requestId)?.projectId
    ?? snapshot.receipts.find((item) => item.requestId === requestId)?.projectId
    ?? null;
}

function workReference(requestId: string) {
  return { surface: "work" as const, path: `/work?request=${encodeURIComponent(requestId)}`, label: "Open work" };
}

function deduplicate(items: DecisionItem[]): DecisionItem[] {
  const byId = new Map<string, DecisionItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new Error("Conflicting decision identity.");
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function facet(items: DecisionItem[], value: (item: DecisionItem) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(value(item), (counts.get(value(item)) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([entry, count]) => ({ value: entry, count }));
}

function inRange(value: number, range: DecisionQuery["range"], now: number): boolean {
  if (range === "all") return true;
  const duration = range === "24h" ? 86_400_000 : range === "7d" ? 604_800_000 : 2_592_000_000;
  return value >= now - duration && value <= now;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function safeText(value: string, maximum: number): string {
  const safe = value
    .replace(/\b(?:sk|gsk|AIza|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = safe || "Decision detail unavailable.";
  return bounded.length <= maximum ? bounded : `${bounded.slice(0, maximum - 1)}…`;
}
