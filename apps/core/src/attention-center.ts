import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  attentionActionSchema,
  attentionMutationResponseSchema,
  attentionPreviewSchema,
  attentionQuerySchema,
  attentionSnapshotSchema,
  quietHoursUpdateSchema,
  type AttentionAction,
  type AttentionCategory,
  type AttentionDisposition,
  type AttentionItem,
  type AttentionMutationResponse,
  type AttentionPreview,
  type AttentionQuery,
  type AttentionSeverity,
  type AttentionSnapshot,
  type QuietHours,
} from "../../../packages/runtime/src/attention.js";
import type { DecisionSnapshot } from "../../../packages/runtime/src/decisions.js";
import type { LiveOperationsSnapshot } from "../../../packages/runtime/src/live-operations.js";
import type { OwnerJourneyCertificationSnapshot, OwnerJourneyTrustSnapshot } from "../../../packages/runtime/src/owner-journey-certification.js";

type Disposition = {
  disposition: AttentionDisposition;
  snoozedUntil: number | null;
  revision: number;
  updatedAt: number;
};
type Stored = {
  schemaVersion: 1;
  revision: number;
  quietHours: QuietHours;
  dispositions: Record<string, Disposition>;
  receipts: StoredReceipt[];
  idempotency: Record<string, { receiptId: string; requestDigest: string }>;
};
type StoredReceipt = AttentionMutationResponse["receipt"];
type Candidate = Omit<
  AttentionItem,
  | "id"
  | "fingerprint"
  | "revision"
  | "disposition"
  | "suppressed"
  | "repeatCount"
  | "snoozedUntil"
  | "firstObservedAt"
> & { seed: string };

const defaultQuietHours: QuietHours = {
  enabled: false,
  startMinute: 1_320,
  endMinute: 480,
  timeZone: "UTC",
  criticalBypass: true,
};
const severityWeight: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

export class LocalAttentionService {
  readonly #path: string;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(stateDirectory: string) {
    this.#path = resolve(stateDirectory, "attention-state.json");
  }

  async snapshot(
    decisions: DecisionSnapshot,
    live: LiveOperationsSnapshot,
    query?: Partial<AttentionQuery>,
    now = Date.now(),
    certification?: OwnerJourneyCertificationSnapshot,
    trust?: OwnerJourneyTrustSnapshot,
  ): Promise<AttentionSnapshot> {
    return this.#serialize(async () =>
      this.#snapshot(
        await this.#read(),
        decisions,
        live,
        query,
        now,
        certification,
        trust,
      ),
    );
  }

  async preview(
    actionInput: unknown,
    decisions: DecisionSnapshot,
    live: LiveOperationsSnapshot,
    now = Date.now(),
    certification?: OwnerJourneyCertificationSnapshot,
    trust?: OwnerJourneyTrustSnapshot,
  ): Promise<AttentionPreview> {
    const action = attentionActionSchema.parse(actionInput);
    return this.#serialize(async () => {
      const state = await this.#read();
      const snapshot = this.#snapshot(
        state,
        decisions,
        live,
        {},
        now,
        certification,
        trust,
      );
      const item = snapshot.items.find((entry) => entry.id === action.itemId);
      if (!item)
        throw new AttentionError("Attention item is unavailable.", "not_found");
      if (item.revision !== action.expectedRevision)
        throw new AttentionError(
          "Attention item changed. Refresh before continuing.",
          "stale_revision",
        );
      return attentionPreviewSchema.parse({
        schemaVersion: 1,
        previewId: `attention_preview_${digest(`${item.id}:${action.action}:${item.revision}`).slice(0, 20)}`,
        action: action.action,
        target: item.title,
        effect: "local_preference_write",
        reversible: true,
        maximumCostUsd: 0,
        previousRevision: item.revision,
        nextDisposition: nextDisposition(action),
        effectiveAt: now,
        expiresAt: now + 60_000,
      });
    });
  }

  async apply(
    actionInput: unknown,
    idempotencyKey: string,
    decisions: DecisionSnapshot,
    live: LiveOperationsSnapshot,
    now = Date.now(),
    certification?: OwnerJourneyCertificationSnapshot,
    trust?: OwnerJourneyTrustSnapshot,
  ): Promise<AttentionMutationResponse> {
    const action = attentionActionSchema.parse(actionInput);
    return this.#serialize(async () => {
      const state = await this.#read();
      const requestDigest = digest(JSON.stringify(action));
      const binding = state.idempotency[idempotencyKey];
      if (binding && binding.requestDigest !== requestDigest)
        throw new AttentionError(
          "Idempotency key is already bound to a different attention action.",
          "idempotency_conflict",
        );
      const existing = state.receipts.find(
        (receipt) => receipt.id === binding?.receiptId,
      );
      if (existing)
        return attentionMutationResponseSchema.parse({
          schemaVersion: 1,
          snapshot: this.#snapshot(
            state,
            decisions,
            live,
            {},
            now,
            certification,
            trust,
          ),
          receipt: existing,
        });
      const snapshot = this.#snapshot(
        state,
        decisions,
        live,
        {},
        now,
        certification,
        trust,
      );
      const item = snapshot.items.find((entry) => entry.id === action.itemId);
      if (!item)
        throw new AttentionError("Attention item is unavailable.", "not_found");
      if (item.revision !== action.expectedRevision)
        throw new AttentionError(
          "Attention item changed. Refresh before continuing.",
          "stale_revision",
        );
      const nextRevision = state.revision + 1;
      state.revision = nextRevision;
      state.dispositions[item.fingerprint] = {
        disposition: nextDisposition(action),
        snoozedUntil:
          action.action === "snooze"
            ? now + action.durationMinutes * 60_000
            : null,
        revision: nextRevision,
        updatedAt: now,
      };
      const receipt = receiptFor(
        idempotencyKey,
        action.action,
        item.id,
        item.revision,
        nextRevision,
        now,
      );
      state.receipts = [...state.receipts, receipt].slice(-500);
      state.idempotency[idempotencyKey] = {
        receiptId: receipt.id,
        requestDigest,
      };
      prune(
        state,
        new Set(snapshot.items.map((entry) => entry.fingerprint)),
        now,
      );
      await this.#write(state);
      return attentionMutationResponseSchema.parse({
        schemaVersion: 1,
        snapshot: this.#snapshot(
          state,
          decisions,
          live,
          {},
          now,
          certification,
          trust,
        ),
        receipt,
      });
    });
  }

  async previewQuietHours(
    input: unknown,
    now = Date.now(),
  ): Promise<AttentionPreview> {
    const quietHours = validateQuietHours(input);
    const state = await this.#read();
    return attentionPreviewSchema.parse({
      schemaVersion: 1,
      previewId: `attention_preview_${digest(JSON.stringify(quietHours)).slice(0, 20)}`,
      action: "quiet_hours",
      target: quietHours.enabled
        ? `Quiet hours ${minuteLabel(quietHours.startMinute)}–${minuteLabel(quietHours.endMinute)}`
        : "Quiet hours disabled",
      effect: "local_preference_write",
      reversible: true,
      maximumCostUsd: 0,
      previousRevision: state.revision,
      nextDisposition: null,
      effectiveAt: now,
      expiresAt: now + 60_000,
    });
  }

  async setQuietHours(
    input: unknown,
    expectedRevision: number,
    idempotencyKey: string,
    decisions: DecisionSnapshot,
    live: LiveOperationsSnapshot,
    now = Date.now(),
  ): Promise<AttentionMutationResponse> {
    const quietHours = validateQuietHours(input);
    return this.#serialize(async () => {
      const state = await this.#read();
      const requestDigest = digest(
        JSON.stringify({ quietHours, expectedRevision }),
      );
      const binding = state.idempotency[idempotencyKey];
      if (binding && binding.requestDigest !== requestDigest)
        throw new AttentionError(
          "Idempotency key is already bound to different quiet-hours settings.",
          "idempotency_conflict",
        );
      const prior = state.receipts.find(
        (receipt) => receipt.id === binding?.receiptId,
      );
      if (prior)
        return attentionMutationResponseSchema.parse({
          schemaVersion: 1,
          snapshot: this.#snapshot(state, decisions, live, {}, now),
          receipt: prior,
        });
      if (state.revision !== expectedRevision)
        throw new AttentionError(
          "Attention preferences changed. Refresh before continuing.",
          "stale_revision",
        );
      state.revision += 1;
      state.quietHours = quietHours;
      const receipt = receiptFor(
        idempotencyKey,
        "quiet_hours",
        "quiet_hours",
        expectedRevision,
        state.revision,
        now,
      );
      state.receipts = [...state.receipts, receipt].slice(-500);
      state.idempotency[idempotencyKey] = {
        receiptId: receipt.id,
        requestDigest,
      };
      await this.#write(state);
      return attentionMutationResponseSchema.parse({
        schemaVersion: 1,
        snapshot: this.#snapshot(state, decisions, live, {}, now),
        receipt,
      });
    });
  }

  #snapshot(
    state: Stored,
    decisions: DecisionSnapshot,
    live: LiveOperationsSnapshot,
    queryInput: Partial<AttentionQuery> = {},
    now = Date.now(),
    certification?: OwnerJourneyCertificationSnapshot,
    trust?: OwnerJourneyTrustSnapshot,
  ): AttentionSnapshot {
    const query = attentionQuerySchema.parse(queryInput);
    const quiet = quietState(state.quietHours, now);
    const candidates = deduplicate([
      ...decisions.items.map(fromDecision),
      ...live.recentEvents
        .filter((event) =>
          ["completed", "review_ready", "verified"].includes(
            event.state.toLowerCase(),
          ),
        )
        .map(fromCompletion),
      ...(certification ? [fromCertification(certification, now)] : []),
      ...(trust ? [fromPilotReadiness(trust)] : []),
    ]);
    const all = candidates
      .map((candidate) => {
        const fingerprint = digest(candidate.seed).slice(0, 32);
        const stored = state.dispositions[fingerprint];
        const expiredSnooze =
          stored?.disposition === "snoozed" &&
          (stored.snoozedUntil ?? 0) <= now;
        const disposition = expiredSnooze
          ? "unread"
          : (stored?.disposition ?? "unread");
        const snoozedUntil =
          disposition === "snoozed" ? (stored?.snoozedUntil ?? null) : null;
        const suppressed =
          disposition === "snoozed" ||
          (quiet.active && candidate.severity !== "critical");
        const { seed, ...safe } = candidate;
        return {
          ...safe,
          id: `attention_${digest(seed).slice(0, 20)}`,
          fingerprint,
          revision: stored?.revision ?? 0,
          disposition,
          suppressed,
          repeatCount: 1,
          snoozedUntil,
          firstObservedAt: candidate.observedAt,
        };
      })
      .sort(
        (left, right) =>
          severityWeight[left.severity] - severityWeight[right.severity] ||
          right.observedAt - left.observedAt ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 250);
    const needle = normalize(query.search);
    const items = all.filter(
      (item) =>
        (query.severities.length === 0 ||
          query.severities.includes(item.severity)) &&
        (query.categories.length === 0 ||
          query.categories.includes(item.category)) &&
        (query.dispositions.length === 0 ||
          query.dispositions.includes(item.disposition)) &&
        (!query.projectId || item.projectId === query.projectId) &&
        (!query.providerId || item.providerId === query.providerId) &&
        (query.includeSuppressed || !item.suppressed) &&
        (!needle ||
          normalize(
            `${item.title} ${item.reason} ${item.nextAction} ${item.category}`,
          ).includes(needle)),
    );
    const deliverable = all.filter(
      (item) => item.disposition === "unread" && !item.suppressed,
    );
    return attentionSnapshotSchema.parse({
      schemaVersion: 1,
      provenance: "local_attention_center",
      observedAt: now,
      validForMs: 15_000,
      automaticSpendLimitUsd: 0,
      revision: state.revision,
      query,
      summary: {
        total: items.length,
        unread: items.filter((item) => item.disposition === "unread").length,
        badge: Math.min(99, deliverable.length),
        critical: items.filter((item) => item.severity === "critical").length,
        snoozed: items.filter((item) => item.disposition === "snoozed").length,
        suppressed: items.filter((item) => item.suppressed).length,
        oldestObservedAt: items.length
          ? Math.min(...items.map((item) => item.observedAt))
          : null,
      },
      facets: {
        severities: facet(all, (item) => item.severity),
        categories: facet(all, (item) => item.category),
        dispositions: facet(all, (item) => item.disposition),
        projects: facet(
          all.filter((item) => item.projectId),
          (item) => item.projectId ?? "",
        ),
        providers: facet(
          all.filter((item) => item.providerId),
          (item) => item.providerId ?? "",
        ),
      },
      quietHours: state.quietHours,
      quietHoursActive: quiet.active,
      nextDeliveryAt: quiet.nextDeliveryAt,
      retention: {
        bounded: true,
        maximumItems: 250,
        maximumReceipts: 500,
        completeness: "bounded_current_state",
      },
      items,
    });
  }

  async #read(): Promise<Stored> {
    try {
      const raw = JSON.parse(await readFile(this.#path, "utf8")) as Stored;
      if (
        raw.schemaVersion !== 1 ||
        !Number.isInteger(raw.revision) ||
        !raw.dispositions ||
        !Array.isArray(raw.receipts) ||
        !raw.idempotency
      )
        throw new Error("invalid");
      return { ...raw, quietHours: validateQuietHours(raw.quietHours) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          schemaVersion: 1,
          revision: 0,
          quietHours: defaultQuietHours,
          dispositions: {},
          receipts: [],
          idempotency: {},
        };
      throw new AttentionError(
        "Attention state is corrupt. Preserve the file and restore or remove it explicitly.",
        "corrupt_state",
      );
    }
  }
  async #write(state: Stored) {
    await mkdir(resolve(this.#path, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.#path);
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
function fromCertification(
  snapshot: OwnerJourneyCertificationSnapshot,
  now: number,
): Candidate {
  const completedAt = snapshot.lastPassedReceipt
    ? Date.parse(snapshot.lastPassedReceipt.completedAt)
    : 0;
  const stale = completedAt > 0 && now - completedAt > 7 * 86_400_000;
  const passed = snapshot.state === "passed" && !stale;
  return candidate({
    seed: `certification:${passed ? "passed" : snapshot.state}:${snapshot.lastPassedReceipt?.certificationId ?? "none"}`,
    severity: snapshot.state === "failed" ? "high" : passed ? "info" : "medium",
    category: snapshot.state === "failed" ? "recovery" : "action",
    title:
      snapshot.state === "failed"
        ? "Owner-journey check needs attention"
        : passed
          ? "Record one real owner session"
          : "Run the owner-journey check",
    reason:
      snapshot.state === "failed"
        ? snapshot.message
        : stale
          ? "The last local certification is older than seven days."
          : passed
            ? "The local synthetic workflow passed; external learning remains deliberately unclaimed."
            : "No current local certification evidence is available.",
    nextAction:
      snapshot.state === "failed" || stale || snapshot.state === "not_run"
        ? "Run the local check"
        : "Start a consented anonymous learning session",
    authorityBoundary: "local_validation_and_learning_only",
    effect: "local_read",
    maximumCostUsd: 0,
    observedAt: snapshot.observedAt,
    projectId: null,
    requestId: null,
    providerId: null,
    source: "system",
    sourceRecordId: snapshot.runId ?? "owner-journey-certification",
    evidence: [
      "Synthetic local evidence only",
      `State: ${snapshot.state}`,
      "Automatic spend limit: $0",
    ],
    reference: {
      surface: "activity",
      path: "/activity?certification=owner-journey",
      label: "Open certification",
    },
  });
}

function fromPilotReadiness(snapshot: OwnerJourneyTrustSnapshot): Candidate {
  const readiness = snapshot.readiness;
  const actionable = readiness.state !== "review_ready";
  return candidate({
    seed: `pilot-readiness:${readiness.state}:${snapshot.learning.completedSessions}:${snapshot.freshness.state}`,
    severity: readiness.state === "certification_needed" ? "high" : actionable ? "medium" : "info",
    category: readiness.state === "certification_needed" ? "recovery" : "action",
    title: readiness.title,
    reason: readiness.reason,
    nextAction: readiness.nextAction,
    authorityBoundary: "local_validation_and_learning_only",
    effect: "local_read",
    maximumCostUsd: 0,
    observedAt: snapshot.observedAt,
    projectId: null,
    requestId: null,
    providerId: null,
    source: "system",
    sourceRecordId: `pilot-readiness-${readiness.state}`,
    evidence: [
      `Completed anonymous sessions: ${snapshot.learning.completedSessions}`,
      `Certification freshness: ${snapshot.freshness.state}`,
      "Automatic spend limit: $0",
    ],
    reference: { surface: "activity", path: "/activity?certification=owner-journey", label: "Open pilot evidence" },
  });
}

export class AttentionError extends Error {
  constructor(
    message: string,
    readonly code:
      "not_found" | "stale_revision" | "idempotency_conflict" | "corrupt_state",
  ) {
    super(message);
  }
}

function fromDecision(item: DecisionSnapshot["items"][number]): Candidate {
  const category: AttentionCategory =
    item.category === "provider"
      ? "provider"
      : ["recovery", "failure", "conflict"].includes(item.category)
        ? "recovery"
        : ["policy"].includes(item.category)
          ? "security"
          : "action";
  return candidate({
    seed: `decision:${item.id}`,
    severity: item.priority === "low" ? "info" : item.priority,
    category,
    title: item.title,
    reason: item.reason,
    nextAction: item.nextAction,
    authorityBoundary: item.authorityBoundary,
    effect: "local_read",
    maximumCostUsd: 0,
    observedAt: item.observedAt,
    projectId: item.projectId,
    requestId: item.requestId,
    providerId: item.providerId,
    source: "decision",
    sourceRecordId: item.id,
    evidence: item.evidence,
    reference: item.reference,
  });
}
function fromCompletion(
  event: LiveOperationsSnapshot["recentEvents"][number],
): Candidate {
  return candidate({
    seed: `completion:${event.id}:${event.state}`,
    severity: "info",
    category: "completion",
    title: event.title,
    reason: event.detail,
    nextAction: "Review verified evidence",
    authorityBoundary: "review_only",
    effect: "local_read",
    maximumCostUsd: 0,
    observedAt: event.observedAt,
    projectId: event.projectId,
    requestId: event.requestId,
    providerId: event.providerId,
    source: "live_operation",
    sourceRecordId: event.id,
    evidence: ["Canonical live operation", `State: ${event.state}`],
    reference: event.requestId
      ? {
          surface: "work",
          path: `/work?request=${encodeURIComponent(event.requestId)}`,
          label: "Open work",
        }
      : { surface: "activity", path: "/activity", label: "Inspect activity" },
  });
}
function candidate(input: Candidate): Candidate {
  return {
    ...input,
    title: safeText(input.title, 160),
    reason: safeText(input.reason, 400),
    nextAction: safeText(input.nextAction, 160),
    evidence: input.evidence.map((value) => safeText(value, 240)).slice(0, 12),
  };
}
function deduplicate(items: Candidate[]): Candidate[] {
  const result = new Map<string, Candidate>();
  for (const item of items) {
    const existing = result.get(item.seed);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item))
      throw new AttentionError(
        "Conflicting attention identity.",
        "corrupt_state",
      );
    result.set(item.seed, item);
  }
  return [...result.values()];
}
function nextDisposition(action: AttentionAction): AttentionDisposition {
  if (action.action === "read") return "read";
  if (action.action === "acknowledge") return "acknowledged";
  if (action.action === "snooze") return "snoozed";
  return "unread";
}
function receiptFor(
  idempotencyKey: string,
  action: StoredReceipt["action"],
  target: string,
  previousRevision: number,
  nextRevision: number,
  now: number,
): StoredReceipt {
  return {
    schemaVersion: 1,
    id: `attention_receipt_${digest(`${idempotencyKey}:${action}:${target}`).slice(0, 20)}`,
    idempotencyKey,
    action,
    target,
    previousRevision,
    nextRevision,
    appliedAt: now,
    outcome: "applied",
  };
}
function validateQuietHours(input: unknown): QuietHours {
  const value = quietHoursUpdateSchema.parse(input);
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format(0);
  } catch {
    throw new AttentionError(
      "Quiet-hours timezone is invalid.",
      "corrupt_state",
    );
  }
  if (value.startMinute === value.endMinute)
    throw new AttentionError(
      "Quiet-hours start and end must differ.",
      "corrupt_state",
    );
  return value;
}
function quietState(preference: QuietHours, now: number) {
  if (!preference.enabled) return { active: false, nextDeliveryAt: null };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: preference.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const minute =
    Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const wraps = preference.startMinute > preference.endMinute;
  const active = wraps
    ? minute >= preference.startMinute || minute < preference.endMinute
    : minute >= preference.startMinute && minute < preference.endMinute;
  if (!active) return { active: false, nextDeliveryAt: null };
  const delta = (preference.endMinute - minute + 1_440) % 1_440 || 1_440;
  return { active: true, nextDeliveryAt: now + delta * 60_000 };
}
function prune(state: Stored, active: Set<string>, now: number) {
  for (const [fingerprint, disposition] of Object.entries(state.dispositions))
    if (
      !active.has(fingerprint) &&
      now - disposition.updatedAt > 30 * 86400_000
    )
      delete state.dispositions[fingerprint];
  const validReceiptIds = new Set(state.receipts.map((receipt) => receipt.id));
  for (const [key, binding] of Object.entries(state.idempotency))
    if (!validReceiptIds.has(binding.receiptId)) delete state.idempotency[key];
}
function facet<T>(items: readonly T[], pick: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(pick(item), (counts.get(pick(item)) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function minuteLabel(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function safeText(value: string, maximum: number) {
  const safe =
    value
      .replace(
        /\b(?:sk|gsk|AIza|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g,
        "[redacted]",
      )
      .replace(
        /\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
        "$1=[redacted]",
      )
      .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
      .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]")
      .replace(/\s+/g, " ")
      .trim() || "Attention detail unavailable.";
  return safe.length <= maximum ? safe : `${safe.slice(0, maximum - 1)}…`;
}
