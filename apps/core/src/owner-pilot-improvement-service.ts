import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ownerPilotImprovementCollectionSchema,
  ownerPilotImprovementDecisionInputSchema,
  ownerPilotImprovementDraftSchema,
  ownerPilotImprovementEditInputSchema,
  ownerPilotImprovementPreviewInputSchema,
  type OwnerPilotImprovement,
  type OwnerPilotImprovementCollection,
  type OwnerPilotImprovementDraft,
  type OwnerPilotReview,
} from "../../../packages/runtime/src/owner-journey-certification.js";

export type ImprovementJiraReceipt = {
  issueId: string;
  issueKey: string;
  url: string;
  evidenceCommented: boolean;
};
export type ImprovementJiraAdapter = {
  selectedProject: (projectId: string) => Promise<{ key: string }>;
  createImprovement: (
    projectId: string,
    improvement: OwnerPilotImprovement,
    marker: string,
  ) => Promise<ImprovementJiraReceipt>;
};
type Stored = {
  schemaVersion: 1;
  drafts: OwnerPilotImprovementDraft[];
  previewKeys: Record<string, string>;
};

export class OwnerPilotImprovementService {
  readonly #path: string;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(
    stateDirectory: string,
    private readonly reviews: { review: () => Promise<OwnerPilotReview> },
    private readonly jira: ImprovementJiraAdapter,
    private readonly now: () => number = Date.now,
  ) {
    this.#path = resolve(stateDirectory, "owner-pilot-improvements.json");
  }

  async list(): Promise<OwnerPilotImprovementCollection> {
    const state = await this.#read();
    return ownerPilotImprovementCollectionSchema.parse({
      schemaVersion: 1,
      provenance: "local_owner_approved_improvement_handoff",
      drafts: state.drafts,
      automaticSpendLimitUsd: 0,
    });
  }

  preview(input: unknown, idempotencyKey: string) {
    return this.#serialize(async () => {
      validateKey(idempotencyKey);
      const value = ownerPilotImprovementPreviewInputSchema.parse(input);
      const state = await this.#read();
      const replay = state.previewKeys[idempotencyKey];
      if (replay) return requireDraft(state, replay);
      const review = await this.reviews.review();
      if (review.state !== "improvements_needed" || review.improvements.length === 0)
        throw new OwnerPilotImprovementError("No evidence-backed improvements are ready for Jira review.");
      if (review.evidenceDigest !== value.expectedReviewDigest)
        throw new OwnerPilotImprovementError("Pilot evidence changed. Refresh before preparing the Jira preview.");
      const selected = await this.jira.selectedProject(value.projectId);
      const createdAt = this.now();
      const id = `improvement_draft_${hash(`${idempotencyKey}:${value.projectId}:${value.expectedReviewDigest}`).slice(0, 20)}`;
      const draft = parseDraft({
        schemaVersion: 1,
        id,
        projectId: value.projectId,
        revision: 1,
        state: "pending",
        reviewDigest: review.evidenceDigest,
        previewDigest: previewDigest(value.projectId, selected.key, review.improvements),
        improvements: review.improvements,
        jiraProjectKey: selected.key,
        createdAt,
        updatedAt: createdAt,
        declinedAt: null,
        completedAt: null,
        receipts: [],
        lastError: null,
        automaticSpendLimitUsd: 0,
      });
      state.drafts = [...state.drafts, draft].slice(-50);
      state.previewKeys[idempotencyKey] = id;
      await this.#write(state);
      return draft;
    });
  }

  edit(id: string, input: unknown) {
    return this.#serialize(async () => {
      const value = ownerPilotImprovementEditInputSchema.parse(input);
      const state = await this.#read();
      const current = mutable(requireDraft(state, id), value.expectedRevision);
      if (current.receipts.length) throw new OwnerPilotImprovementError("Jira creation already began; completed receipts cannot be edited.");
      const next = parseDraft({
        ...current,
        revision: current.revision + 1,
        improvements: value.improvements,
        previewDigest: previewDigest(current.projectId, current.jiraProjectKey, value.improvements),
        updatedAt: this.now(),
        lastError: null,
      });
      state.drafts = replace(state.drafts, next);
      await this.#write(state);
      return next;
    });
  }

  decline(id: string, input: unknown) {
    return this.#serialize(async () => {
      const value = ownerPilotImprovementDecisionInputSchema.parse(input);
      const state = await this.#read();
      const current = mutable(requireDraft(state, id), value.expectedRevision);
      verifyPreview(current, value.expectedPreviewDigest);
      if (current.receipts.length) throw new OwnerPilotImprovementError("Jira creation already began; retry or resolve the partial handoff instead.");
      const at = this.now();
      const next = parseDraft({ ...current, revision: current.revision + 1, state: "declined", declinedAt: at, updatedAt: at, lastError: null });
      state.drafts = replace(state.drafts, next);
      await this.#write(state);
      return next;
    });
  }

  approve(id: string, input: unknown) {
    return this.#serialize(async () => {
      const value = ownerPilotImprovementDecisionInputSchema.parse(input);
      const state = await this.#read();
      let current = requireDraft(state, id);
      if (current.state === "completed") {
        verifyPreview(current, value.expectedPreviewDigest);
        return current;
      }
      if (!["pending", "partially_applied"].includes(current.state) || current.revision !== value.expectedRevision)
        throw new OwnerPilotImprovementError("Improvement preview changed. Refresh before approving.");
      verifyPreview(current, value.expectedPreviewDigest);
      current = parseDraft({ ...current, state: "applying", updatedAt: this.now(), lastError: null });
      state.drafts = replace(state.drafts, current);
      await this.#write(state);
      for (const improvement of current.improvements) {
        if (current.receipts.some((receipt) => receipt.improvementId === improvement.id)) continue;
        try {
          const receipt = await this.jira.createImprovement(
            current.projectId,
            improvement,
            `codkesh_pilot_${current.id.slice(-12)}_${improvement.id.slice(-8)}`,
          );
          current = parseDraft({
            ...current,
            receipts: [...current.receipts, { improvementId: improvement.id, ...receipt }],
            updatedAt: this.now(),
          });
          state.drafts = replace(state.drafts, current);
          await this.#write(state);
        } catch (error) {
          current = parseDraft({
            ...current,
            revision: current.revision + 1,
            state: "partially_applied",
            updatedAt: this.now(),
            lastError: safeError(error),
          });
          state.drafts = replace(state.drafts, current);
          await this.#write(state);
          return current;
        }
      }
      const completedAt = this.now();
      current = parseDraft({ ...current, revision: current.revision + 1, state: "completed", completedAt, updatedAt: completedAt, lastError: null });
      state.drafts = replace(state.drafts, current);
      await this.#write(state);
      return current;
    });
  }

  async #read(): Promise<Stored> {
    try {
      const state = JSON.parse(await readFile(this.#path, "utf8")) as Stored;
      if (state.schemaVersion !== 1 || !state.previewKeys) throw new Error("invalid");
      ownerPilotImprovementCollectionSchema.parse({ schemaVersion: 1, provenance: "local_owner_approved_improvement_handoff", drafts: state.drafts, automaticSpendLimitUsd: 0 });
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, drafts: [], previewKeys: {} };
      throw new OwnerPilotImprovementError("Improvement handoff state is corrupt. Preserve it before explicit recovery.");
    }
  }
  async #write(state: Stored) {
    await mkdir(resolve(this.#path, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#path);
  }
  #serialize<T>(operation: () => Promise<T>) {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class OwnerPilotImprovementError extends Error {}
function parseDraft(value: unknown) { return ownerPilotImprovementDraftSchema.parse(value); }
function replace(values: OwnerPilotImprovementDraft[], next: OwnerPilotImprovementDraft) { return values.map((value) => value.id === next.id ? next : value); }
function requireDraft(state: Stored, id: string) { const value = state.drafts.find((draft) => draft.id === id); if (!value) throw new OwnerPilotImprovementError("Improvement preview is unavailable."); return value; }
function mutable(value: OwnerPilotImprovementDraft, revision: number) { if (value.state !== "pending" || value.revision !== revision) throw new OwnerPilotImprovementError("Improvement preview changed. Refresh before continuing."); return value; }
function verifyPreview(value: OwnerPilotImprovementDraft, digest: string) { if (value.previewDigest !== digest) throw new OwnerPilotImprovementError("The exact preview was not approved. Refresh and review it again."); }
function previewDigest(projectId: string, jiraProjectKey: string, improvements: readonly OwnerPilotImprovement[]) { return hash(JSON.stringify({ projectId, jiraProjectKey, improvements })); }
function validateKey(value: string) { if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(value)) throw new OwnerPilotImprovementError("A valid idempotency key is required."); }
function safeError(error: unknown) { const message = error instanceof Error ? error.message : "Jira handoff failed safely."; return message.replace(/(?:bearer|token|secret|password|api[_-]?key)\s*[:=]?\s*\S+/gi, "credential [redacted]").slice(0, 240) || "Jira handoff failed safely."; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
