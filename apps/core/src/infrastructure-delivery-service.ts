import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import {
  approveInfrastructureMutation,
  createInfrastructureMutationPreview,
  digestInfrastructureDesign,
  executeInfrastructureMutation,
  rollbackInfrastructureMutation,
  infrastructureApprovalSchema,
  infrastructureDesignSchema,
  infrastructureDeliveryStatusSchema,
  infrastructureMutationPreviewSchema,
  infrastructureReceiptSchema,
  type InfrastructureAdapter,
  type InfrastructureApproval,
  type InfrastructureDesign,
  type InfrastructureDeliveryStatus,
  type InfrastructureMutationPreview,
  type InfrastructureReceipt,
} from "../../../packages/orchestration/src/infrastructure-delivery.js";

const previewRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.string().regex(/^request_[a-f0-9]{20}$/),
  provider: z.string().trim().min(2).max(80),
  accountId: z.string().trim().min(2).max(200),
  projectOrTenantId: z.string().trim().min(2).max(200),
  resourceId: z.string().trim().min(2).max(300),
  region: z.string().trim().min(2).max(100),
  action: z.enum(["create", "configure", "migrate", "deploy", "promote", "delete", "rollback"]),
  permissions: z.array(z.string().trim().min(2).max(200)).min(1).max(50),
  maximumCostUsd: z.literal(0),
  reversible: z.boolean(),
  rollbackAction: z.string().trim().min(3).max(4_000),
});

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  designs: z.record(z.string(), infrastructureDesignSchema),
  previews: z.record(z.string(), infrastructureMutationPreviewSchema),
  approvals: z.record(z.string(), infrastructureApprovalSchema),
  receipts: z.record(z.string(), infrastructureReceiptSchema),
  idempotency: z.record(z.string(), z.string()),
});

type State = z.infer<typeof stateSchema>;

export class InfrastructureDeliveryService {
  readonly #path: string;
  #state: State | null = null;

  public constructor(
    stateDirectory: string,
    private readonly adapters: ReadonlyMap<string, InfrastructureAdapter>,
    private readonly now: () => number = Date.now,
  ) { this.#path = resolve(stateDirectory, "infrastructure-delivery.json"); }

  public async getDesign(projectId: string): Promise<InfrastructureDesign | null> {
    return (await this.#load()).designs[projectId] ?? null;
  }

  public async status(projectId: string): Promise<InfrastructureDeliveryStatus> {
    const state = await this.#load();
    const operations = Object.values(state.previews)
      .filter((preview) => preview.projectId === projectId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((preview) => ({ preview, approval: state.approvals[preview.id] ?? null, receipt: state.receipts[preview.id] ?? null }));
    return infrastructureDeliveryStatusSchema.parse({ schemaVersion: 1, design: state.designs[projectId] ?? null, operations });
  }

  public async publishDesign(projectId: string, input: unknown, idempotencyKey: string): Promise<InfrastructureDesign> {
    const design = infrastructureDesignSchema.parse(input);
    if (design.projectId !== projectId) throw new Error("Infrastructure design belongs to another project.");
    const state = await this.#load();
    const replay = this.#replay<InfrastructureDesign>(state, idempotencyKey, "design", design.projectId);
    if (replay) return replay;
    state.designs[projectId] = design; state.idempotency[idempotencyKey] = `design:${projectId}`; await this.#save(state); return design;
  }

  public async preview(projectId: string, input: unknown, idempotencyKey: string): Promise<InfrastructureMutationPreview> {
    const request = previewRequestSchema.parse(input); const state = await this.#load();
    const replay = this.#replay<InfrastructureMutationPreview>(state, idempotencyKey, "preview"); if (replay) return replay;
    const design = state.designs[projectId]; if (!design) throw new Error("Approved infrastructure design was not found.");
    if (request.requestId !== design.requestId) throw new Error("Infrastructure request was superseded by a different design.");
    const resource = design.resources.find((entry) => entry.provider === request.provider && entry.accountId === request.accountId && entry.projectOrTenantId === request.projectOrTenantId && entry.resourceId === request.resourceId && entry.region === request.region);
    if (!resource) throw new Error("Infrastructure target is not present in the approved design inventory.");
    const createdAt = this.now();
    const preview = createInfrastructureMutationPreview({ ...request, projectId, designDigest: digestInfrastructureDesign(design), idempotencyKey: `infra:${projectId}:${idempotencyKey}`, createdAt, expiresAt: createdAt + 15 * 60_000 });
    state.previews[preview.id] = preview; state.idempotency[idempotencyKey] = `preview:${preview.id}`; await this.#save(state); return preview;
  }

  public async approve(projectId: string, previewId: string, idempotencyKey: string): Promise<InfrastructureApproval> {
    const state = await this.#load(); const replay = this.#replay<InfrastructureApproval>(state, idempotencyKey, "approval"); if (replay) return replay;
    const preview = state.previews[previewId]; if (!preview || preview.projectId !== projectId) throw new Error("Infrastructure preview was not found for this project.");
    const approval = approveInfrastructureMutation(preview, this.now(), 10 * 60_000);
    state.approvals[previewId] = approval; state.idempotency[idempotencyKey] = `approval:${previewId}`; await this.#save(state); return approval;
  }

  public async execute(projectId: string, previewId: string, idempotencyKey: string): Promise<InfrastructureReceipt> {
    const state = await this.#load(); const replay = this.#replay<InfrastructureReceipt>(state, idempotencyKey, "receipt"); if (replay) return replay;
    const preview = state.previews[previewId]; const approval = state.approvals[previewId]; const design = state.designs[projectId];
    if (!preview || preview.projectId !== projectId || !approval || !design) throw new Error("Infrastructure execution requires a current design, exact preview, and owner approval.");
    const adapter = this.adapters.get(preview.provider); if (!adapter) throw new Error("The approved infrastructure provider is not available on this computer.");
    const completed = new Map(Object.values(state.receipts).map((receipt) => [state.previews[receipt.previewId]?.idempotencyKey ?? "", receipt]));
    const receipt = await executeInfrastructureMutation({ preview, approval, design, adapter, now: this.now(), completed });
    state.receipts[previewId] = receipt; state.idempotency[idempotencyKey] = `receipt:${previewId}`; await this.#save(state); return receipt;
  }

  public async receipt(projectId: string, previewId: string): Promise<InfrastructureReceipt | null> {
    const state = await this.#load(); const preview = state.previews[previewId]; if (!preview || preview.projectId !== projectId) return null; return state.receipts[previewId] ?? null;
  }

  public async rollback(projectId: string, previewId: string, idempotencyKey: string): Promise<InfrastructureReceipt> {
    const state = await this.#load(); const replay = this.#replay<InfrastructureReceipt>(state, idempotencyKey, "receipt"); if (replay) return replay;
    const preview = state.previews[previewId]; const approval = state.approvals[previewId]; const design = state.designs[projectId]; const receipt = state.receipts[previewId];
    if (!preview || preview.projectId !== projectId || !approval || !design || !receipt) throw new Error("Infrastructure rollback requires the exact approved deployment receipt.");
    const adapter = this.adapters.get(preview.provider); if (!adapter) throw new Error("The approved infrastructure provider is not available on this computer.");
    const rolledBack = await rollbackInfrastructureMutation({ preview, approval, design, receipt, adapter, now: this.now() });
    state.receipts[previewId] = rolledBack; state.idempotency[idempotencyKey] = `receipt:${previewId}`; await this.#save(state); return rolledBack;
  }

  async #load(): Promise<State> {
    if (this.#state) return this.#state;
    try { this.#state = stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; this.#state = stateSchema.parse({ schemaVersion: 1, designs: {}, previews: {}, approvals: {}, receipts: {}, idempotency: {} }); }
    return this.#state;
  }

  #replay<T>(state: State, key: string, kind: "design" | "preview" | "approval" | "receipt", expectedId?: string): T | null {
    const reference = state.idempotency[key]; if (!reference) return null;
    const [storedKind, id] = reference.split(":"); if (storedKind !== kind || !id || (expectedId && id !== expectedId)) throw new Error("Idempotency key was already used for another infrastructure operation.");
    const value = kind === "design" ? state.designs[id] : kind === "preview" ? state.previews[id] : kind === "approval" ? state.approvals[id] : state.receipts[id];
    if (!value) throw new Error("Infrastructure idempotency evidence is incomplete."); return value as T;
  }

  async #save(state: State) { await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 }); const temporary = `${this.#path}.tmp`; await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temporary, this.#path); }
}
