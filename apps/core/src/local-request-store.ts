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
  localExecutionAuthorizationRequestSchema,
  localExecutionAuthoritySchema,
  localExecutionRunSchema,
  localPatchApprovalRequestSchema,
  localPatchApprovalSchema,
  localPatchPreviewRequestSchema,
  localCommitApprovalRequestSchema,
  localCommitApprovalSchema,
  localCommitPreviewRequestSchema,
  localIntegrationApprovalRequestSchema,
  localIntegrationApprovalSchema,
  localIntegrationPreviewRequestSchema,
  localPlanningSnapshotSchema,
  localRequestSchema,
  validateLocalRequestCollection,
  type LocalDraftPlan,
  type LocalGrounding,
  type LocalTopology,
  type LocalRequest,
  type LocalRequestCollection,
} from "../../../packages/runtime/src/local-requests.js";
import {
  compileExecutionManifest,
  inspectGitRepository,
  prepareIsolatedWorktree,
  locateIsolatedWorktree,
  preserveWorkspace,
} from "./local-execution.js";
import {
  observeBoundedChanges,
  runBoundedValidation,
} from "./local-validation.js";
import {
  applyReplacement,
  previewReplacement,
  rollbackReplacement,
} from "./local-patch.js";
import {
  createIsolatedCommit,
  previewIsolatedCommit,
  undoIsolatedCommit,
} from "./local-commit.js";
import {
  createLocalIntegration,
  previewLocalIntegration,
  undoLocalIntegration,
} from "./local-integration.js";

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
  readonly #stateDirectory: string;
  readonly #projectExists: (projectId: string) => Promise<boolean>;
  readonly #projectRoot: (projectId: string) => Promise<string>;
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    stateDirectory: string,
    projectExists: (projectId: string) => Promise<boolean>,
    projectRoot: (projectId: string) => Promise<string> = async () => process.cwd()
  ) {
    this.#stateDirectory = resolve(stateDirectory);
    this.#storePath = resolve(stateDirectory, "local-requests.json");
    this.#projectExists = projectExists;
    this.#projectRoot = projectRoot;
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

  authorizeExecution(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const authorization = localExecutionAuthorizationRequestSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.execution) return record.request;
      const plan = record.request.plan;
      if (
        record.request.state !== "approved" ||
        !record.request.run ||
        !plan ||
        plan.state !== "approved" ||
        !plan.approval
      ) {
        throw new LocalRequestError(
          "invalid_transition",
          "Approve and freeze the grounded plan before authorizing execution."
        );
      }
      if (
        plan.revision !== authorization.expectedPlanRevision ||
        plan.digest !== authorization.expectedPlanDigest
      ) {
        throw new LocalRequestError(
          "stale_revision",
          "The approved plan changed. Refresh before authorizing execution."
        );
      }
      if (!record.request.grounding || !record.request.topology) {
        throw new LocalRequestError("grounding_mismatch", "Execution requires current grounding.");
      }
      const root = await this.#projectRoot(record.request.projectId);
      const preflight = await inspectGitRepository(root);
      const manifest = compileExecutionManifest(plan, preflight.baseline);
      const authorizedAt = Date.now();
      const canonical = JSON.stringify({
        requestId: record.request.id,
        projectId: record.request.projectId,
        planDigest: plan.digest,
        planRevision: plan.revision,
        planApprovalDigest: plan.approval.digest,
        groundingDigest: record.request.grounding.digest,
        topologyDigest: record.request.topology.digest,
        preflightDigest: preflight.digest,
        manifestDigest: manifest.digest,
        isolationProfile: authorization.isolationProfile,
        maximumCostUsd: 0,
      });
      const authorityDigest = digest(canonical);
      const authority = localExecutionAuthoritySchema.parse({
        schemaVersion: 1,
        id: `authority_${authorityDigest.slice(0, 20)}`,
        digest: authorityDigest,
        requestId: record.request.id,
        projectId: record.request.projectId,
        planDigest: plan.digest,
        planRevision: plan.revision,
        planApprovalDigest: plan.approval.digest,
        groundingDigest: record.request.grounding.digest,
        topologyDigest: record.request.topology.digest,
        preflight,
        manifest,
        isolationProfile: authorization.isolationProfile,
        maximumCostUsd: 0,
        authorizedAt,
        expiresAt: authorizedAt + 15 * 60_000,
      });
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: authorizedAt,
        execution: {
          schemaVersion: 1,
          state: "authorized",
          authority,
          workspace: null,
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run.events,
            "execution_authorized",
            authorizedAt,
            "Clean baseline and isolated-worktree-only authority approved."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  prepareExecution(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.execution?.state === "ready") return record.request;
      if (
        !record.request.execution ||
        record.request.execution.state !== "authorized" ||
        Date.now() >= record.request.execution.authority.expiresAt
      ) {
        throw new LocalRequestError(
          "invalid_transition",
          "Execution authority is missing or expired. Authorize the current plan again."
        );
      }
      const preparingAt = Date.now();
      const preparing = localRequestSchema.parse({
        ...record.request,
        updatedAt: preparingAt,
        execution: { ...record.request.execution, state: "preparing" },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "workspace_preparing",
            preparingAt,
            "Preparing a private isolated Git worktree from the verified baseline."
          ),
        },
      });
      await this.#replace(store, preparing);
      const root = await this.#projectRoot(record.request.projectId);
      const workspace = await prepareIsolatedWorktree({
        stateDirectory: this.#stateDirectory,
        canonicalRoot: root,
        requestId: record.request.id,
        authority: record.request.execution.authority,
      });
      const readyAt = Date.now();
      const ready = localRequestSchema.parse({
        ...preparing,
        updatedAt: readyAt,
        execution: { ...preparing.execution, state: "ready", workspace },
        run: {
          ...preparing.run,
          events: appendEvent(
            preparing.run?.events ?? [],
            "workspace_ready",
            readyAt,
            "Isolated worktree verified; no task, provider, network, or command execution started."
          ),
        },
      });
      await this.#replace(await this.#load(), ready);
      return ready;
    });
  }

  cancelExecution(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.execution?.state === "cancelled") return record.request;
      if (
        !record.request.execution ||
        ![
          "authorized",
          "ready",
          "preparing",
          "validating",
          "validated",
          "review_ready",
          "failed",
        ].includes(record.request.execution.state)
      ) {
        throw new LocalRequestError("invalid_transition", "No active execution session can be cancelled.");
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        execution: {
          ...record.request.execution,
          state: "cancelled",
          workspace: record.request.execution.workspace
            ? preserveWorkspace(record.request.execution.workspace, "preserved")
            : null,
          run: record.request.execution.run
            ? localExecutionRunSchema.parse({
                ...record.request.execution.run,
                state: "cancelled",
                completedAt: Date.now(),
              })
            : null,
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "execution_cancelled",
            now,
            "Execution cancelled; any isolated workspace was preserved for explicit recovery."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  reconcileExecution(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      if (record.request.execution?.state === "interrupted") return record.request;
      if (
        !record.request.execution ||
        !["preparing", "validating"].includes(record.request.execution.state)
      ) {
        throw new LocalRequestError(
          "invalid_transition",
          "Only an interrupted preparation can be reconciled."
        );
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        execution: {
          ...record.request.execution,
          state: "interrupted",
          workspace: record.request.execution.workspace
            ? preserveWorkspace(record.request.execution.workspace, "interrupted")
            : null,
          run: record.request.execution.run
            ? localExecutionRunSchema.parse({
                ...record.request.execution.run,
                state: "interrupted",
                completedAt: Date.now(),
              })
            : null,
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "execution_reconciled",
            now,
            "Interrupted preparation preserved; explicit user recovery is required."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  startExecution(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      if (execution?.run) return record.request;
      if (
        !execution ||
        execution.state !== "ready" ||
        !execution.workspace ||
        execution.workspace.state !== "ready"
      ) {
        throw new LocalRequestError(
          "invalid_transition",
          "Prepare and verify the isolated workspace before starting a run."
        );
      }
      const startedAt = Date.now();
      const runBody = {
        schemaVersion: 1 as const,
        id: `execution_${digest(execution.authority.digest).slice(0, 20)}`,
        state: "ready" as const,
        authorityDigest: execution.authority.digest,
        manifestDigest: execution.authority.manifest.digest,
        workspaceRef: execution.workspace.workspaceRef,
        baseline: execution.workspace.baseline,
        maximumCostUsd: 0 as const,
        startedAt,
        completedAt: null,
        attempts: [],
        changes: null,
      };
      const run = localExecutionRunSchema.parse({
        ...runBody,
        digest: digest(JSON.stringify(runBody)),
      });
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: startedAt,
        execution: { ...execution, run },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "execution_started",
            startedAt,
            "Bounded local run created; no command has executed yet."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  validateExecution(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      if (
        !execution ||
        execution.state !== "ready" ||
        !execution.workspace ||
        !execution.run ||
        execution.run.state !== "ready"
      ) {
        if (
          execution?.run &&
          ["passed", "failed"].includes(execution.run.state)
        ) {
          return record.request;
        }
        throw new LocalRequestError(
          "invalid_transition",
          "Start a ready bounded run before deterministic validation."
        );
      }
      const validatingAt = Date.now();
      const validatingRun = localExecutionRunSchema.parse({
        ...execution.run,
        state: "validating",
      });
      const validating = localRequestSchema.parse({
        ...record.request,
        updatedAt: validatingAt,
        execution: { ...execution, state: "validating", run: validatingRun },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "validation_started",
            validatingAt,
            "Running fixed-argument git diff --check in the isolated workspace."
          ),
        },
      });
      await this.#replace(store, validating);

      const workspacePath = locateIsolatedWorktree({
        stateDirectory: this.#stateDirectory,
        requestId,
        authority: execution.authority,
      });
      const attemptId = `attempt_${digest(
        `${execution.run.digest}:${execution.run.attempts.length + 1}`
      ).slice(0, 20)}`;
      const attempt = await runBoundedValidation({
        workspacePath,
        authority: execution.authority,
        attemptId,
        startedAt: validatingAt,
      });
      const canonicalRoot = await this.#projectRoot(record.request.projectId);
      const changes = await observeBoundedChanges({
        workspacePath,
        canonicalRoot,
        authority: execution.authority,
      });
      const passed = attempt.state === "passed" && changes.allowed;
      const reviewReady = passed && changes.changedPaths.length > 0;
      const completedAt = Date.now();
      const completedRun = localExecutionRunSchema.parse({
        ...validatingRun,
        state: passed ? "passed" : "failed",
        completedAt,
        attempts: [...validatingRun.attempts, attempt],
        changes,
      });
      const completed = localRequestSchema.parse({
        ...validating,
        updatedAt: completedAt,
        execution: {
          ...validating.execution,
          state: passed ? (reviewReady ? "review_ready" : "validated") : "failed",
          run: completedRun,
        },
        run: {
          ...validating.run,
          events: appendEvent(
            validating.run?.events ?? [],
            passed ? "validation_completed" : "validation_failed",
            completedAt,
            passed
              ? reviewReady
                ? "Validation passed and approved isolated changes are ready for review."
                : "Validation passed; no isolated source changes were observed."
              : "Validation or approved-path policy failed; review is required."
          ),
        },
      });
      await this.#replace(await this.#load(), completed);
      return completed;
    });
  }

  previewPatch(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const proposal = localPatchPreviewRequestSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      if (
        !execution ||
        execution.state !== "ready" ||
        !execution.workspace ||
        !execution.run ||
        execution.run.state !== "ready"
      ) {
        throw new LocalRequestError(
          "invalid_transition",
          "Start a ready bounded run before previewing a patch."
        );
      }
      if (
        proposal.expectedAuthorityDigest !== execution.authority.digest ||
        proposal.expectedRunDigest !== execution.run.digest
      ) {
        throw new LocalRequestError("stale_revision", "Execution changed before patch preview.");
      }
      if (execution.patch) {
        if (
          execution.patch.preview.path === proposal.path &&
          (proposal.expectedBeforeDigest === null ||
            execution.patch.preview.beforeDigest === proposal.expectedBeforeDigest) &&
          execution.patch.preview.replacementContent === proposal.replacementContent
        ) {
          return record.request;
        }
        throw new LocalRequestError(
          "plan_immutable",
          "A patch already exists for this run. Roll it back or start a new run."
        );
      }
      const workspacePath = locateIsolatedWorktree({
        stateDirectory: this.#stateDirectory,
        requestId,
        authority: execution.authority,
      });
      const preview = await previewReplacement({
        workspacePath,
        authority: execution.authority,
        run: execution.run,
        path: proposal.path,
        expectedBeforeDigest: proposal.expectedBeforeDigest,
        replacementContent: proposal.replacementContent,
      });
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        execution: {
          ...execution,
          patch: {
            schemaVersion: 1,
            state: "previewed",
            preview,
            approval: null,
            receipt: null,
            rolledBackAt: null,
          },
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "patch_previewed",
            now,
            `Bounded replacement previewed for ${preview.path}; no file was written.`
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  approvePatch(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const approvalRequest = localPatchApprovalRequestSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const patch = record.request.execution?.patch;
      if (patch?.state === "approved") return record.request;
      if (!patch || patch.state !== "previewed") {
        throw new LocalRequestError("invalid_transition", "Preview the exact patch first.");
      }
      if (patch.preview.digest !== approvalRequest.expectedPreviewDigest) {
        throw new LocalRequestError("stale_revision", "Patch preview changed before approval.");
      }
      const approvedAt = Date.now();
      const approval = localPatchApprovalSchema.parse({
        schemaVersion: 1,
        previewDigest: patch.preview.digest,
        approvedAt,
        digest: digest(`${patch.preview.digest}:${approvedAt}:isolated_replacement_only`),
      });
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: approvedAt,
        execution: {
          ...record.request.execution,
          patch: { ...patch, state: "approved", approval },
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "patch_approved",
            approvedAt,
            "Exact isolated replacement approved; application has not started."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  applyPatch(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const patch = execution?.patch;
      if (patch?.state === "applied") return record.request;
      if (
        !execution ||
        !execution.workspace ||
        !execution.run ||
        !patch ||
        patch.state !== "approved" ||
        !patch.approval ||
        patch.approval.previewDigest !== patch.preview.digest
      ) {
        throw new LocalRequestError("invalid_transition", "Approve the current patch preview first.");
      }
      const applyingAt = Date.now();
      const applying = localRequestSchema.parse({
        ...record.request,
        updatedAt: applyingAt,
        execution: { ...execution, patch: { ...patch, state: "applying" } },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "patch_applying",
            applyingAt,
            "Applying one approved replacement inside the isolated worktree."
          ),
        },
      });
      await this.#replace(store, applying);
      const workspacePath = locateIsolatedWorktree({
        stateDirectory: this.#stateDirectory,
        requestId,
        authority: execution.authority,
      });
      const receipt = await applyReplacement({
        workspacePath,
        canonicalRoot: await this.#projectRoot(record.request.projectId),
        recoveryDirectory: resolve(this.#stateDirectory, "patch-recovery", requestId),
        authority: execution.authority,
        preview: patch.preview,
      });
      const appliedAt = Date.now();
      const applied = localRequestSchema.parse({
        ...applying,
        updatedAt: appliedAt,
        execution: {
          ...applying.execution,
          patch: { ...applying.execution?.patch, state: "applied", receipt },
        },
        run: {
          ...applying.run,
          events: appendEvent(
            applying.run?.events ?? [],
            "patch_applied",
            appliedAt,
            "Isolated replacement bytes verified; no commit, merge, push, or publication occurred."
          ),
        },
      });
      await this.#replace(await this.#load(), applied);
      return applied;
    });
  }

  rollbackPatch(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const patch = execution?.patch;
      if (patch?.state === "rolled_back") return record.request;
      if (
        !execution ||
        !patch ||
        patch.state !== "applied" ||
        !patch.receipt
      ) {
        throw new LocalRequestError("invalid_transition", "Only an applied patch can be rolled back.");
      }
      await rollbackReplacement({
        workspacePath: locateIsolatedWorktree({
          stateDirectory: this.#stateDirectory,
          requestId,
          authority: execution.authority,
        }),
        recoveryDirectory: resolve(this.#stateDirectory, "patch-recovery", requestId),
        authority: execution.authority,
        preview: patch.preview,
        receipt: patch.receipt,
      });
      const rolledBackAt = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: rolledBackAt,
        execution: {
          ...execution,
          patch: { ...patch, state: "rolled_back", rolledBackAt },
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "patch_rolled_back",
            rolledBackAt,
            "Exact pre-patch isolated bytes restored and verified."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  reconcilePatch(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const patch = execution?.patch;
      if (patch?.state === "interrupted") return record.request;
      if (!execution || !patch || patch.state !== "applying") {
        throw new LocalRequestError(
          "invalid_transition",
          "Only an interrupted patch application can be reconciled."
        );
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        execution: { ...execution, patch: { ...patch, state: "interrupted" } },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "patch_reconciled",
            now,
            "Interrupted patch preserved for explicit file and recovery-evidence inspection."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  previewCommit(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const proposal = localCommitPreviewRequestSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      if (
        !execution ||
        execution.state !== "review_ready" ||
        !execution.workspace ||
        !execution.run ||
        execution.run.state !== "passed" ||
        !execution.patch?.receipt ||
        execution.patch.state !== "applied"
      ) {
        throw new LocalRequestError(
          "invalid_transition",
          "A validated, review-ready isolated patch is required before commit preview."
        );
      }
      if (
        proposal.expectedAuthorityDigest !== execution.authority.digest ||
        proposal.expectedRunDigest !== execution.run.digest
      ) {
        throw new LocalRequestError("stale_revision", "Execution changed before commit preview.");
      }
      if (execution.commit) {
        if (execution.commit.preview.message === proposal.message.trim()) return record.request;
        throw new LocalRequestError("plan_immutable", "A commit preview already exists.");
      }
      const preview = await previewIsolatedCommit({
        workspacePath: locateIsolatedWorktree({
          stateDirectory: this.#stateDirectory,
          requestId,
          authority: execution.authority,
        }),
        canonicalRoot: await this.#projectRoot(record.request.projectId),
        authority: execution.authority,
        run: execution.run,
        patchReceipt: execution.patch.receipt,
        message: proposal.message,
      });
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        execution: {
          ...execution,
          commit: {
            schemaVersion: 1,
            state: "previewed",
            preview,
            approval: null,
            receipt: null,
            undoneAt: null,
          },
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "commit_previewed",
            now,
            "Hook-free isolated commit preview recorded; no paths were staged."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  approveCommit(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const approvalRequest = localCommitApprovalRequestSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const commit = record.request.execution?.commit;
      if (commit?.state === "approved") return record.request;
      if (!commit || commit.state !== "previewed") {
        throw new LocalRequestError("invalid_transition", "Preview the exact isolated commit first.");
      }
      if (approvalRequest.expectedPreviewDigest !== commit.preview.digest) {
        throw new LocalRequestError("stale_revision", "Commit preview changed before approval.");
      }
      const approvedAt = Date.now();
      const approval = localCommitApprovalSchema.parse({
        schemaVersion: 1,
        previewDigest: commit.preview.digest,
        approvedAt,
        digest: digest(`${commit.preview.digest}:${approvedAt}:isolated_commit_only`),
      });
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: approvedAt,
        execution: {
          ...record.request.execution,
          commit: { ...commit, state: "approved", approval },
        },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "commit_approved",
            approvedAt,
            "Exact local isolated commit approved; creation has not started."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  createCommit(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const commit = execution?.commit;
      if (commit?.state === "created") return record.request;
      if (!execution || !commit || commit.state !== "approved" || !commit.approval) {
        throw new LocalRequestError("invalid_transition", "Approve the commit preview first.");
      }
      const creatingAt = Date.now();
      const creating = localRequestSchema.parse({
        ...record.request,
        updatedAt: creatingAt,
        execution: { ...execution, commit: { ...commit, state: "creating" } },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "commit_creating",
            creatingAt,
            "Creating one hook-free commit on the isolated branch."
          ),
        },
      });
      await this.#replace(store, creating);
      const receipt = await createIsolatedCommit({
        workspacePath: locateIsolatedWorktree({
          stateDirectory: this.#stateDirectory,
          requestId,
          authority: execution.authority,
        }),
        canonicalRoot: await this.#projectRoot(record.request.projectId),
        authority: execution.authority,
        preview: commit.preview,
      });
      const now = Date.now();
      const created = localRequestSchema.parse({
        ...creating,
        updatedAt: now,
        execution: {
          ...creating.execution,
          commit: { ...creating.execution?.commit, state: "created", receipt },
        },
        run: {
          ...creating.run,
          events: appendEvent(
            creating.run?.events ?? [],
            "commit_created",
            now,
            "Local isolated commit verified; it was not merged, pushed, published, or deployed."
          ),
        },
      });
      await this.#replace(await this.#load(), created);
      return created;
    });
  }

  undoCommit(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const commit = execution?.commit;
      if (commit?.state === "undone") return record.request;
      if (!execution || !commit?.receipt || commit.state !== "created") {
        throw new LocalRequestError("invalid_transition", "Only a created isolated commit can be undone.");
      }
      await undoIsolatedCommit({
        workspacePath: locateIsolatedWorktree({
          stateDirectory: this.#stateDirectory,
          requestId,
          authority: execution.authority,
        }),
        canonicalRoot: await this.#projectRoot(record.request.projectId),
        receipt: commit.receipt,
      });
      const undoneAt = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: undoneAt,
        execution: { ...execution, commit: { ...commit, state: "undone", undoneAt } },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "commit_undone",
            undoneAt,
            "Isolated commit removed; validated patch bytes remain uncommitted."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  reconcileCommit(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const commit = execution?.commit;
      if (commit?.state === "interrupted") return record.request;
      if (!execution || !commit || commit.state !== "creating") {
        throw new LocalRequestError(
          "invalid_transition",
          "Only interrupted commit creation can be reconciled."
        );
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request,
        updatedAt: now,
        execution: { ...execution, commit: { ...commit, state: "interrupted" } },
        run: {
          ...record.request.run,
          events: appendEvent(
            record.request.run?.events ?? [],
            "commit_reconciled",
            now,
            "Interrupted commit preserved for explicit Git inspection; no retry was attempted."
          ),
        },
      });
      await this.#replace(store, request);
      return request;
    });
  }

  previewIntegration(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const proposal = localIntegrationPreviewRequestSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const commit = execution?.commit;
      if (!execution || !commit?.receipt || commit.state !== "created") {
        throw new LocalRequestError("invalid_transition", "Create and verify the isolated commit first.");
      }
      if (proposal.expectedCommitReceiptDigest !== commit.receipt.digest) {
        throw new LocalRequestError("stale_revision", "Commit receipt changed before integration preview.");
      }
      if (execution.integration) return record.request;
      const preview = await previewLocalIntegration({
        canonicalRoot: await this.#projectRoot(record.request.projectId),
        authority: execution.authority,
        commitReceipt: commit.receipt,
      });
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request, updatedAt: now,
        execution: { ...execution, integration: {
          schemaVersion: 1, state: "previewed", preview, approval: null, receipt: null, undoneAt: null,
        }},
        run: { ...record.request.run, events: appendEvent(
          record.request.run?.events ?? [], "integration_previewed", now,
          "Canonical integration preview and disposable conflict probe passed; no canonical files changed."
        )},
      });
      await this.#replace(store, request);
      return request;
    });
  }

  approveIntegration(requestId: string, input: unknown): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const proposal = localIntegrationApprovalRequestSchema.parse(input);
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const integration = execution?.integration;
      if (integration?.state === "approved") return record.request;
      if (!execution || !integration || integration.state !== "previewed") {
        throw new LocalRequestError("invalid_transition", "Preview canonical integration first.");
      }
      if (proposal.expectedPreviewDigest !== integration.preview.digest) {
        throw new LocalRequestError("stale_revision", "Integration preview changed before approval.");
      }
      const approvedAt = Date.now();
      const approval = localIntegrationApprovalSchema.parse({
        schemaVersion: 1, previewDigest: integration.preview.digest, approvedAt,
        digest: digest(`${integration.preview.digest}:${approvedAt}:local_integration_only`),
      });
      const request = localRequestSchema.parse({
        ...record.request, updatedAt: approvedAt,
        execution: { ...execution, integration: { ...integration, state: "approved", approval }},
        run: { ...record.request.run, events: appendEvent(
          record.request.run?.events ?? [], "integration_approved", approvedAt,
          "Exact local canonical integration approved; no remote effect was authorized."
        )},
      });
      await this.#replace(store, request);
      return request;
    });
  }

  createIntegration(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const integration = execution?.integration;
      if (integration?.state === "created") return record.request;
      if (!execution || !integration?.approval || integration.state !== "approved") {
        throw new LocalRequestError("invalid_transition", "Approve the exact integration preview first.");
      }
      const startedAt = Date.now();
      const creating = localRequestSchema.parse({
        ...record.request, updatedAt: startedAt,
        execution: { ...execution, integration: { ...integration, state: "creating" }},
        run: { ...record.request.run, events: appendEvent(
          record.request.run?.events ?? [], "integration_creating", startedAt,
          "Integrating one approved commit into the local canonical branch."
        )},
      });
      await this.#replace(store, creating);
      const receipt = await createLocalIntegration({
        canonicalRoot: await this.#projectRoot(record.request.projectId), preview: integration.preview,
      });
      const now = Date.now();
      const created = localRequestSchema.parse({
        ...creating, updatedAt: now,
        execution: { ...creating.execution, integration: {
          ...creating.execution?.integration, state: "created", receipt,
        }},
        run: { ...creating.run, events: appendEvent(
          creating.run?.events ?? [], "integration_created", now,
          "Canonical local commit verified; nothing was pushed, published or deployed."
        )},
      });
      await this.#replace(await this.#load(), created);
      return created;
    });
  }

  undoIntegration(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const integration = execution?.integration;
      if (integration?.state === "undone") return record.request;
      if (!execution || !integration?.receipt || integration.state !== "created") {
        throw new LocalRequestError("invalid_transition", "Only the exact latest local integration can be undone.");
      }
      await undoLocalIntegration({
        canonicalRoot: await this.#projectRoot(record.request.projectId), receipt: integration.receipt,
      });
      const undoneAt = Date.now();
      const request = localRequestSchema.parse({
        ...record.request, updatedAt: undoneAt,
        execution: { ...execution, integration: { ...integration, state: "undone", undoneAt }},
        run: { ...record.request.run, events: appendEvent(
          record.request.run?.events ?? [], "integration_undone", undoneAt,
          "Canonical branch restored to its exact pre-integration HEAD."
        )},
      });
      await this.#replace(store, request);
      return request;
    });
  }

  reconcileIntegration(requestId: string): Promise<LocalRequest> {
    return this.#serialize(async () => {
      const store = await this.#load();
      const record = findRecord(store, requestId);
      const execution = record.request.execution;
      const integration = execution?.integration;
      if (integration?.state === "interrupted") return record.request;
      if (!execution || !integration || integration.state !== "creating") {
        throw new LocalRequestError("invalid_transition", "Only interrupted integration can be reconciled.");
      }
      const now = Date.now();
      const request = localRequestSchema.parse({
        ...record.request, updatedAt: now,
        execution: { ...execution, integration: { ...integration, state: "interrupted" }},
        run: { ...record.request.run, events: appendEvent(
          record.request.run?.events ?? [], "integration_reconciled", now,
          "Interrupted integration preserved for exact canonical Git inspection; no retry was attempted."
        )},
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
    | "plan_approved"
    | "execution_authorized"
    | "workspace_preparing"
    | "workspace_ready"
    | "execution_cancelled"
    | "execution_reconciled"
    | "execution_started"
    | "validation_started"
    | "validation_completed"
    | "validation_failed"
    | "patch_previewed"
    | "patch_approved"
    | "patch_applying"
    | "patch_applied"
    | "patch_rolled_back"
    | "patch_reconciled"
    | "commit_previewed"
    | "commit_approved"
    | "commit_creating"
    | "commit_created"
    | "commit_undone"
    | "commit_reconciled"
    | "integration_previewed"
    | "integration_approved"
    | "integration_creating"
    | "integration_created"
    | "integration_undone"
    | "integration_reconciled",
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
