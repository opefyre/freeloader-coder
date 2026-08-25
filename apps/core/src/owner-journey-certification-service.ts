import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ownerJourneyCertificationPreviewSchema,
  ownerJourneyCertificationReceiptSchema,
  ownerJourneyCertificationRunResponseSchema,
  ownerJourneyCertificationSnapshotSchema,
  type OwnerJourneyCertificationReceipt,
  type OwnerJourneyCertificationRunResponse,
  type OwnerJourneyCertificationSnapshot,
} from "../../../packages/runtime/src/owner-journey-certification.js";
import {
  certifyOwnerJourney,
  validateOwnerJourneyCertification,
} from "./owner-journey-certification.js";

type Stored = {
  schemaVersion: 1;
  state: "not_run" | "running" | "passed" | "failed";
  runId: string | null;
  message: string;
  receipt: OwnerJourneyCertificationReceipt | null;
  lastPassedReceipt: OwnerJourneyCertificationReceipt | null;
  history: OwnerJourneyCertificationReceipt[];
  idempotency: Record<string, string>;
};

const empty: Stored = {
  schemaVersion: 1,
  state: "not_run",
  runId: null,
  message: "Certification has not run yet.",
  receipt: null,
  lastPassedReceipt: null,
  history: [],
  idempotency: {},
};

export class OwnerJourneyCertificationService {
  readonly #path: string;
  readonly #run: () => Promise<OwnerJourneyCertificationReceipt>;
  #active: Promise<OwnerJourneyCertificationRunResponse> | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    stateDirectory: string,
    run: () => Promise<OwnerJourneyCertificationReceipt> = () =>
      certifyOwnerJourney(),
  ) {
    this.#path = resolve(stateDirectory, "owner-journey-certification.json");
    this.#run = run;
  }

  async snapshot(now = Date.now()): Promise<OwnerJourneyCertificationSnapshot> {
    return this.#snapshot(await this.#read(), now);
  }

  async preview(now = Date.now()) {
    const state = await this.#read();
    return ownerJourneyCertificationPreviewSchema.parse({
      schemaVersion: 1,
      previewId: `cert_preview_${hash(`${state.lastPassedReceipt?.certificationId ?? "none"}:${now}`).slice(0, 20)}`,
      effect: "local_validation_only",
      maximumCostUsd: 0,
      externalEffects: 0,
      estimatedMaximumMinutes: 10,
      preservesPriorPassingEvidence: true,
    });
  }

  run(
    idempotencyKey: string,
    now = Date.now(),
  ): Promise<OwnerJourneyCertificationRunResponse> {
    if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
      throw new CertificationServiceError(
        "A valid idempotency key is required.",
        "invalid_request",
      );
    if (this.#active) return this.#active;
    this.#active = this.#serialize(async () => {
      const state = await this.#read();
      const prior = state.idempotency[idempotencyKey];
      if (prior) {
        if (
          prior !== state.receipt?.certificationId &&
          prior !== state.lastPassedReceipt?.certificationId
        )
          throw new CertificationServiceError(
            "Certification replay evidence is unavailable.",
            "corrupt_state",
          );
        return ownerJourneyCertificationRunResponseSchema.parse({
          schemaVersion: 1,
          outcome: "replayed",
          snapshot: this.#snapshot(state, now),
        });
      }
      const runId = `cert_run_${hash(`${idempotencyKey}:${now}`).slice(0, 20)}`;
      await this.#write({
        ...state,
        state: "running",
        runId,
        message: "Running the local zero-cost owner journey.",
      });
      try {
        const receipt = validateOwnerJourneyCertification(await this.#run());
        const next: Stored = {
          ...state,
          state: "passed",
          runId,
          message: "All 11 owner-journey stages passed locally.",
          receipt,
          lastPassedReceipt: receipt,
          history: deduplicate([...state.history, receipt]).slice(-50),
          idempotency: {
            ...state.idempotency,
            [idempotencyKey]: receipt.certificationId,
          },
        };
        await this.#write(next);
        return ownerJourneyCertificationRunResponseSchema.parse({
          schemaVersion: 1,
          outcome: "started",
          snapshot: this.#snapshot(next, Date.now()),
        });
      } catch {
        const failed: Stored = {
          ...state,
          state: "failed",
          runId,
          receipt: null,
          message:
            "Certification did not pass. Prior passing evidence was preserved.",
        };
        await this.#write(failed);
        throw new CertificationServiceError(failed.message, "failed");
      }
    }).finally(() => {
      this.#active = null;
    });
    return this.#active;
  }

  #snapshot(state: Stored, now: number) {
    return ownerJourneyCertificationSnapshotSchema.parse({
      schemaVersion: 1,
      provenance: "local_owner_journey_certification",
      observedAt: now,
      validForMs: 15_000,
      automaticSpendLimitUsd: 0,
      state: state.state,
      runId: state.runId,
      message: state.message,
      receipt: state.receipt,
      lastPassedReceipt: state.lastPassedReceipt,
      historyCount: state.history.length,
    });
  }
  async #read(): Promise<Stored> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as Stored;
      if (
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.history) ||
        !parsed.idempotency
      )
        throw new Error("invalid");
      if (parsed.receipt)
        ownerJourneyCertificationReceiptSchema.parse(parsed.receipt);
      if (parsed.lastPassedReceipt)
        ownerJourneyCertificationReceiptSchema.parse(parsed.lastPassedReceipt);
      parsed.history.forEach((receipt) =>
        ownerJourneyCertificationReceiptSchema.parse(receipt),
      );
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return structuredClone(empty);
      throw new CertificationServiceError(
        "Certification state is corrupt. Preserve it before explicit recovery.",
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

export class CertificationServiceError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_request" | "failed" | "corrupt_state",
  ) {
    super(message);
  }
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function deduplicate(receipts: OwnerJourneyCertificationReceipt[]) {
  return [
    ...new Map(
      receipts.map((receipt) => [receipt.certificationId, receipt]),
    ).values(),
  ];
}
