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
  localRequestSchema,
  validateLocalRequestCollection,
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
      if (!["queued", "approved"].includes(record.request.state)) {
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
      if (!record.request.run || record.request.state !== "approved") {
        throw new LocalRequestError("invalid_transition", "Approve the contract before claiming it.");
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
        (error instanceof Error && error.message.startsWith("Local run"))
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
    | "lease_expired",
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
