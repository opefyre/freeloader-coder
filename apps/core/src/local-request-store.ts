import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import {
  localRequestCreationSchema,
  localPlanApprovalSchema,
  localPlanEditSchema,
  localPlanningSnapshotSchema,
  localRequestSchema,
  validateLocalRequestCollection,
  type LocalDraftPlan,
  type LocalGrounding,
  type LocalTopology,
  type LocalRequest,
  type LocalRequestCollection,
} from "../../../packages/runtime/src/local-requests.js";

const MAX_REQUESTS = 500;
const sensitiveMaterial =
  /(api[_-]?key|password|private[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i;

const privateRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  idempotencyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  request: localRequestSchema,
});
const privateStoreSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requests: z.array(privateRequestSchema).max(MAX_REQUESTS),
});
type PrivateStore = z.infer<typeof privateStoreSchema>;

export class LocalRequestStore {
  readonly #storePath: string;
  readonly #projectExists: (projectId: string) => Promise<boolean>;
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    stateDirectory: string,
    projectExists: (projectId: string) => Promise<boolean>
  ) {
    this.#storePath = resolve(stateDirectory, "local-requests.json");
    this.#projectExists = projectExists;
  }

  async list(): Promise<LocalRequestCollection> {
    const store = await this.#load();
    return validateLocalRequestCollection({
      schemaVersion: 1,
      provenance: "local_observation",
      observedAt: Date.now(),
      requests: store.requests
        .map((record) => record.request)
        .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)),
    });
  }

  create(input: unknown, idempotencyKey: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const creation = localRequestCreationSchema.parse(input);
      const idempotencyDigest = digest(idempotencyKey);
      const store = await this.#load();
      const replay = store.requests.find(
        (record) => record.idempotencyDigest === idempotencyDigest
      );
      if (replay) {
        if (
          replay.request.projectId !== creation.projectId ||
          replay.request.outcome !== creation.outcome.trim()
        ) {
          throw new LocalRequestError(
            "idempotency_conflict",
            "That idempotency key was already used for a different request."
          );
        }
        return replay.request;
      }
      if (!(await this.#projectExists(creation.projectId))) {
        throw new LocalRequestError(
          "project_not_found",
          "Choose a currently registered local project."
        );
      }
      if (store.requests.length >= MAX_REQUESTS) {
        throw new LocalRequestError(
          "capacity",
          "Archive terminal requests before creating more work."
        );
      }
      const outcome = creation.outcome.trim();
      if (sensitiveMaterial.test(outcome)) {
        throw new LocalRequestError(
          "sensitive_material",
          "Remove likely credentials or secrets before creating work."
        );
      }
      const now = Date.now();
      const request: LocalRequest = localRequestSchema.parse({
        schemaVersion: 1,
        id: `request_${createHash("sha256")
          .update(`${idempotencyDigest}:${creation.projectId}:${outcome}`)
          .digest("hex")
          .slice(0, 20)}`,
        projectId: creation.projectId,
        outcome,
        readiness: "ready",
        state: "queued",
        provenance: "local_request",
        createdAt: now,
        updatedAt: now,
        findings: [
          {
            code: "implementation_assumption",
            severity: "assumption",
            title: "Implementation approach",
            detail: "Use existing project patterns and the smallest reversible change.",
          },
        ],
        workPreview: {
          provenance: "deterministic_local_preview",
          title: outcome.length > 100 ? `${outcome.slice(0, 97)}…` : outcome,
          outcome,
          assumptions: ["Use existing project patterns and the smallest reversible change."],
          exclusions: [
            "No provider or worker has been selected.",
            "No project source has been changed.",
          ],
          checks: ["Inspect project guidance", "Run repository-defined validation"],
          estimatedMinutes: 45,
        },
        run: null,
      });
      await this.#save({
        schemaVersion: 1,
        requests: [...store.requests, { schemaVersion: 1, idempotencyDigest, request }],
      });
      return request;
    });
  }

  cancel(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = store.requests.find((item) => item.request.id === requestId);
      if (!record) throw new LocalRequestError("not_found", "Request was not found.");
      if (record.request.state === "cancelled") return record.request;
      if (record.request.state !== "queued") {
        throw new LocalRequestError("invalid_transition", "Only queued work can be cancelled.");
      }
      const request = localRequestSchema.parse({
        ...record.request,
        state: "cancelled",
        updatedAt: Date.now(),
      });
      await this.#save({
        schemaVersion: 1,
        requests: store.requests.map((item) =>
          item.request.id === requestId ? { ...item, request } : item
        ),
      });
      return request;
    });
  }

  approve(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.run) return record.request;
      if (record.request.state !== "queued" || !record.request.workPreview) {
        throw new LocalRequestError("invalid_transition", "Only ready queued work can be approved.");
      }
      const approvedAt = Date.now();
      const canonical = JSON.stringify({
        requestId: record.request.id,
        projectId: record.request.projectId,
        outcome: record.request.outcome,
        checks: record.request.workPreview.checks,
        policy: "zero_effect",
        allowedEffects: [],
        maximumCostUsd: 0,
      });
      const contractDigest = digest(canonical);
      const request = localRequestSchema.parse({
        ...record.request,
        state: "approved",
        updatedAt: approvedAt,
        run: {
          state: "approved",
          contract: {
            schemaVersion: 1,
            id: `contract_${contractDigest.slice(0, 20)}`,
            digest: contractDigest,
            requestId: record.request.id,
            projectId: record.request.projectId,
            outcome: record.request.outcome,
            policy: "zero_effect",
            allowedEffects: [],
            maximumCostUsd: 0,
            checks: record.request.workPreview.checks,
            approvedAt,
          },
          lease: null,
          events: [event(1, "contract_approved", approvedAt, "Zero-effect contract approved.")],
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  claim(requestId: string, leaseMs = 60_000): Promise<LocalRequest> {
    return this.#serialize(async () => {
      if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 300_000) {
        throw new LocalRequestError("invalid_transition", "Lease duration is outside the safe bound.");
      }
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (
        record.request.state === "claimed" &&
        record.request.run?.lease &&
        record.request.run.lease.expiresAt > Date.now()
      ) {
        return record.request;
      }
      if (
        !record.request.run ||
        record.request.state !== "approved" ||
        record.request.plan?.state !== "approved"
      ) {
        throw new LocalRequestError(
          "invalid_transition",
          "Approve the grounded plan before claiming its zero-effect proof lease."
        );
      }
      const now = Date.now();
      const leaseDigest = digest(`${record.request.run.contract.digest}:${now}`);
      const request = localRequestSchema.parse({
        ...record.request,
        state: "claimed",
        updatedAt: now,
        run: {
          ...record.request.run,
          state: "claimed",
          lease: {
            id: `lease_${leaseDigest.slice(0, 20)}`,
            owner: "local_zero_effect_coordinator",
            expiresAt: now + leaseMs,
          },
          events: appendEvent(
            record.request.run.events,
            "lease_claimed",
            now,
            "Local zero-effect coordinator claimed the contract."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  checkpoint(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.state === "checkpointed") return record.request;
      const run = activeRun(record.request, "claimed");
      if (!run.lease || run.lease.expiresAt <= Date.now()) {
        throw new LocalRequestError("lease_expired", "The execution lease expired before checkpoint.");
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        state: "checkpointed",
        updatedAt: now,
        run: {
          ...run,
          state: "checkpointed",
          events: appendEvent(
            run.events,
            "checkpoint_observed",
            now,
            "Zero external effects observed; checkpoint recorded."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  release(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.state === "completed") return record.request;
      const run = activeRun(record.request, "checkpointed");
      if (!run.lease || run.lease.expiresAt <= Date.now()) {
        throw new LocalRequestError("lease_expired", "The execution lease expired before release.");
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        state: "completed",
        updatedAt: now,
        run: {
          ...run,
          state: "completed",
          lease: null,
          events: appendEvent(
            run.events,
            "lease_released",
            now,
            "Lease released after zero-effect lifecycle proof."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  reconcile(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (!record.request.run || !record.request.run.lease) return record.request;
      if (record.request.run.lease.expiresAt > Date.now()) {
        throw new LocalRequestError("lease_active", "The current lease is still active.");
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        state: "interrupted",
        updatedAt: now,
        run: {
          ...record.request.run,
          state: "interrupted",
          lease: null,
          events: appendEvent(
            record.request.run.events,
            "lease_expired",
            now,
            "Expired lease reconciled; user review is required before retry."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  ground(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const snapshot = localPlanningSnapshotSchema.parse(input);
      const { grounding, topology } = snapshot;
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (!record.request.run || record.request.state !== "approved") {
        throw new LocalRequestError(
          "invalid_transition",
          "Approve the zero-effect contract before grounding the request."
        );
      }
      if (
        grounding.projectId !== record.request.projectId ||
        topology.projectId !== record.request.projectId
      ) {
        throw new LocalRequestError("grounding_mismatch", "Grounding does not match the request project.");
      }
      if (record.request.grounding) {
        if (
          record.request.grounding.digest !== grounding.digest ||
          record.request.topology?.digest !== topology.digest
        ) {
          throw new LocalRequestError(
            "stale_source",
            "Project grounding changed. Create a new approval before replacing the plan."
          );
        }
        return record.request;
      }
      const plan = createLocalPlan(
        record.request.outcome,
        grounding,
        topology,
        record.request.run.contract.checks
      );
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        grounding,
        topology,
        plan,
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run.events,
            "grounding_created",
            now,
            "Bounded local grounding and deterministic draft plan created."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  updatePlan(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const edit = localPlanEditSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const plan = editablePlan(record.request);
      const replay =
        plan.revision === edit.expectedRevision + 1 &&
        (edit.type === "edit_task"
          ? plan.tasks.some(
              (task) =>
                task.id === edit.taskId &&
                task.title === edit.title.trim() &&
                task.estimatedMinutes === edit.estimatedMinutes
            )
          : plan.order.join("\0") === edit.order.join("\0"));
      if (replay) return record.request;
      if (plan.revision !== edit.expectedRevision) {
        throw new LocalRequestError(
          "stale_revision",
          "The plan changed since it was opened. Refresh before editing."
        );
      }
      let tasks = [...plan.tasks];
      let order = [...plan.order];
      if (edit.type === "edit_task") {
        if (!tasks.some((task) => task.id === edit.taskId)) {
          throw new LocalRequestError("invalid_transition", "Plan task was not found.");
        }
        tasks = tasks.map((task) =>
          task.id === edit.taskId
            ? { ...task, title: edit.title.trim(), estimatedMinutes: edit.estimatedMinutes }
            : task
        );
      } else {
        validateOrder(tasks, edit.order);
        order = [...edit.order];
      }
      const revision = plan.revision + 1;
      const nextPlan = withPlanDigest({
        ...plan,
        revision,
        tasks,
        order,
      });
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        plan: nextPlan,
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "plan_updated",
            now,
            `Plan revision ${revision} saved without execution authority.`
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  approvePlan(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const approval = localPlanApprovalSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.plan?.state === "approved") return record.request;
      const plan = editablePlan(record.request);
      if (plan.revision !== approval.expectedRevision) {
        throw new LocalRequestError(
          "stale_revision",
          "The plan changed since it was opened. Refresh before approval."
        );
      }
      const approvedAt = Date.now();
      const approvalDigest = digest(JSON.stringify({
        planDigest: plan.digest,
        revision: plan.revision,
        contractDigest: record.request.run?.contract.digest,
        policy: "zero_effect",
        executionAuthorized: false,
      }));
      const approvedPlan = withPlanDigest({
        ...plan,
        state: "approved",
        approval: {
          digest: approvalDigest,
          revision: plan.revision,
          approvedAt,
          policy: "zero_effect",
          executionAuthorized: false,
        },
      });
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: approvedAt,
        plan: approvedPlan,
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "plan_approved",
            approvedAt,
            `Plan revision ${plan.revision} approved; execution remains unauthorized.`
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  archive(requestId: string): Promise<void> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = store.requests.find((item) => item.request.id === requestId);
      if (!record) throw new LocalRequestError("not_found", "Request was not found.");
      if (!["cancelled", "completed", "interrupted"].includes(record.request.state)) {
        throw new LocalRequestError(
          "invalid_transition",
          "Cancel queued work before archiving it."
        );
      }
      await this.#save({
        schemaVersion: 1,
        requests: store.requests.filter((item) => item.request.id !== requestId),
      });
    });
  }

  async #replace(store: PrivateStore, request: LocalRequest): Promise<void> {
    await this.#save({
      schemaVersion: 1,
      requests: store.requests.map((item) =>
        item.request.id === request.id ? { ...item, request } : item
      ),
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#writeQueue.then(operation, operation);
    this.#writeQueue = next.catch(() => undefined);
    return next;
  }

  async #load(): Promise<PrivateStore> {
    try {
      const store = privateStoreSchema.parse(
        JSON.parse(await readFile(this.#storePath, "utf8")) as unknown
      );
      validateLocalRequestCollection({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt: Date.now(),
        requests: store.requests.map((record) => record.request),
      });
      return store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, requests: [] };
      }
      if (
        error instanceof SyntaxError ||
        error instanceof z.ZodError ||
        (error instanceof Error &&
          (error.message.startsWith("Local run") ||
            error.message.startsWith("Local plan")))
      ) {
        throw new LocalRequestError(
          "store_invalid",
          "The local request store is invalid. It was preserved for recovery."
        );
      }
      throw error;
    }
  }

  async #save(store: PrivateStore): Promise<void> {
    const parsed = privateStoreSchema.parse(store);
    await mkdir(dirname(this.#storePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.#storePath), 0o700);
    const temporary = `${this.#storePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const file = await open(temporary, "r");
      await file.sync();
      await file.close();
      await rename(temporary, this.#storePath);
      await chmod(this.#storePath, 0o600);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export class LocalRequestError extends Error {
  constructor(
    readonly code:
      | "idempotency_conflict"
      | "project_not_found"
      | "sensitive_material"
      | "capacity"
      | "not_found"
      | "invalid_transition"
      | "lease_expired"
      | "lease_active"
      | "grounding_mismatch"
      | "stale_source"
      | "stale_revision"
      | "plan_immutable"
      | "store_invalid",
    message: string
  ) {
    super(message);
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function findRecord(store: PrivateStore, requestId: string) {
  const record = store.requests.find((item) => item.request.id === requestId);
  if (!record) throw new LocalRequestError("not_found", "Request was not found.");
  return record;
}

function activeRun(request: LocalRequest, state: "claimed" | "checkpointed") {
  if (!request.run || request.state !== state || request.run.state !== state) {
    throw new LocalRequestError(
      "invalid_transition",
      `Request must be ${state} before this action.`
    );
  }
  return request.run;
}

function event(
  sequence: number,
  type:
    | "contract_approved"
    | "lease_claimed"
    | "checkpoint_observed"
    | "lease_released"
    | "lease_expired"
    | "grounding_created"
    | "plan_updated"
    | "plan_approved",
  observedAt: number,
  detail: string
) {
  return { sequence, type, observedAt, detail } as const;
}

function appendEvent(
  events: NonNullable<LocalRequest["run"]>["events"],
  type: Parameters<typeof event>[1],
  observedAt: number,
  detail: string
) {
  return [...events, event(events.length + 1, type, observedAt, detail)];
}

function createLocalPlan(
  outcome: string,
  grounding: LocalGrounding,
  topology: LocalTopology,
  checks: readonly string[]
): LocalDraftPlan {
  const citedSources = grounding.sources.slice(0, 6).map((source) => source.path);
  const implementationEntries = topology.entries
    .filter((entry) => ["source", "config", "documentation"].includes(entry.kind))
    .sort((left, right) => {
      const priority = { source: 0, config: 1, documentation: 2 } as const;
      return targetScore(right.path, outcome) - targetScore(left.path, outcome) ||
        priority[left.kind as keyof typeof priority] -
        priority[right.kind as keyof typeof priority] ||
        left.path.localeCompare(right.path);
    });
  const fallback = topology.entries.filter((entry) => entry.kind !== "asset");
  const candidates = implementationEntries.length > 0 ? implementationEntries : fallback;
  const groups = new Map<string, string[]>();
  for (const entry of candidates) {
    const key = topologyGroup(entry.path);
    const paths = groups.get(key) ?? [];
    if (paths.length < 6) paths.push(entry.path);
    groups.set(key, paths);
  }
  const selectedGroups = [...groups.entries()].slice(0, 3);
  if (selectedGroups.length === 0) {
    throw new LocalRequestError(
      "grounding_mismatch",
      "No safe implementation target was observed in the bounded topology."
    );
  }
  const tasks: LocalDraftPlan["tasks"][number][] = selectedGroups.map(
    ([group, allowedFiles], index) => {
      const identity = digest(JSON.stringify({
        outcome,
        grounding: grounding.digest,
        topology: topology.digest,
        group,
      }));
      return {
        id: `task_${identity.slice(0, 12)}`,
        title: `Implement the requested outcome in ${group}`,
        outcome,
        scope: [
          `Change only the observed ${group} targets listed in this task.`,
          "Preserve repository guidance and existing project patterns.",
        ],
        allowedFiles,
        citedSources,
        dependsOn: index === 0 ? [] : [],
        acceptanceCriteria: [
          "The task outcome is satisfied within its declared file scope.",
          "Repository-defined checks pass before completion is claimed.",
        ],
        exclusions: [
          "Plan approval does not authorize source changes or command execution.",
          "No model, provider, Git operation, credential, network, or paid route is enabled.",
        ],
        checks: [...checks],
        risk: allowedFiles.some((path) => path.includes("config") || path.endsWith("package.json"))
          ? "medium"
          : "low",
        estimatedMinutes: Math.min(120, 25 + allowedFiles.length * 10),
      };
    }
  );
  const testFiles = topology.entries
    .filter((entry) => entry.kind === "test")
    .map((entry) => entry.path)
    .filter((path) => !tasks.some((task) => task.allowedFiles.includes(path)))
    .slice(0, 12);
  if (testFiles.length > 0 && tasks.length < 8) {
    const identity = digest(JSON.stringify({
      outcome,
      topology: topology.digest,
      kind: "validation",
      testFiles,
    }));
    tasks.push({
      id: `task_${identity.slice(0, 12)}`,
      title: "Validate the requested outcome with observed tests",
      outcome: `Prove the requested outcome using the repository's observed test surface.`,
      scope: ["Update only observed test targets and record deterministic validation evidence."],
      allowedFiles: testFiles,
      citedSources,
      dependsOn: tasks.map((task) => task.id),
      acceptanceCriteria: [
        "Relevant tests cover the requested behavior.",
        "Validation evidence distinguishes observed results from model claims.",
      ],
      exclusions: [
        "Plan approval does not run tests or authorize test-file changes.",
        "No validation result is claimed until a later execution stage observes it.",
      ],
      checks: [...checks],
      risk: "low",
      estimatedMinutes: Math.min(120, 20 + testFiles.length * 8),
    });
  }
  return withPlanDigest({
    schemaVersion: 1,
    provenance: "deterministic_local_plan",
    digest: "0".repeat(64),
    groundingDigest: grounding.digest,
    topologyDigest: topology.digest,
    revision: 1,
    state: "draft",
    order: tasks.map((task) => task.id),
    approval: null,
    tasks,
  });
}

function topologyGroup(path: string): string {
  const parts = path.split("/");
  if (["apps", "packages"].includes(parts[0] ?? "") && parts.length > 1) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts.length > 1 ? parts[0] ?? "repository root" : "repository root";
}

function targetScore(path: string, outcome: string): number {
  const normalizedPath = path.toLocaleLowerCase();
  const normalizedOutcome = outcome.toLocaleLowerCase();
  const stopWords = new Set([
    "with", "from", "into", "that", "this", "safe", "local", "requested", "outcome",
  ]);
  const tokens = normalizedOutcome
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token));
  let score = tokens.reduce(
    (total, token) => total + (normalizedPath.includes(token) ? 8 : 0),
    0
  );
  const signals: [RegExp, readonly string[]][] = [
    [/(ui|screen|page|review|conversation|dashboard)/, ["apps/studio", ".tsx", ".css"]],
    [/(api|control|server|request|queue)/, ["apps/core", "control-plane", "request"]],
    [/(plan|task|orchestrat|dependenc)/, ["orchestration", "task-planner", "local-request"]],
    [/(test|validat|quality|qa)/, ["tests/", ".test.", "validation"]],
    [/(provider|model|quota|routing)/, ["providers", "provider"]],
    [/(runtime|schema|contract)/, ["packages/runtime", "schema", "contract"]],
  ];
  for (const [pattern, hints] of signals) {
    if (pattern.test(normalizedOutcome)) {
      score += hints.reduce(
        (total, hint) => total + (normalizedPath.includes(hint) ? 5 : 0),
        0
      );
    }
  }
  return score;
}

function withPlanDigest(plan: LocalDraftPlan): LocalDraftPlan {
  const { digest: _ignored, ...canonical } = plan;
  return {
    ...plan,
    digest: digest(JSON.stringify(canonical)),
  };
}

function editablePlan(request: LocalRequest): LocalDraftPlan {
  if (
    request.state !== "approved" ||
    !request.run ||
    !request.grounding ||
    !request.topology ||
    !request.plan
  ) {
    throw new LocalRequestError(
      "invalid_transition",
      "Ground the approved request before editing its plan."
    );
  }
  if (request.plan.state !== "draft") {
    throw new LocalRequestError("plan_immutable", "Approved plans are immutable.");
  }
  return request.plan;
}

function validateOrder(
  tasks: LocalDraftPlan["tasks"],
  order: readonly string[]
): void {
  const ids = tasks.map((task) => task.id);
  if (
    order.length !== ids.length ||
    new Set(order).size !== ids.length ||
    order.some((id) => !ids.includes(id))
  ) {
    throw new LocalRequestError(
      "invalid_transition",
      "Plan order must contain every task exactly once."
    );
  }
  const position = new Map(order.map((id, index) => [id, index]));
  for (const task of tasks) {
    if (
      task.dependsOn.some(
        (dependency) =>
          (position.get(dependency) ?? Infinity) >= (position.get(task.id) ?? -1)
      )
    ) {
      throw new LocalRequestError(
        "invalid_transition",
        "Dependent work cannot be ordered before its prerequisite."
      );
    }
  }
}
