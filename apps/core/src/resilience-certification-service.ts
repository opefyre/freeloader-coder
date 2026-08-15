import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  certifyResilience,
  type ResilienceCertification,
  type ResilienceObservation,
  type ResilienceScenario,
} from "../../../packages/orchestration/src/resilience-certification.js";

export interface DurableResilienceObservation extends ResilienceObservation {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly requestId: string;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly recoveryReceipt: string;
  readonly observedAt: number;
}

interface ResilienceState {
  readonly schemaVersion: 1;
  readonly observations: readonly DurableResilienceObservation[];
}

const projectPattern = /^project_[a-f0-9]{16}$/;
const requestPattern = /^request_[a-f0-9]{20}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const receiptPattern = /^(?:receipt|journal|event):[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,500}$/;

export class ResilienceCertificationService {
  readonly #path: string;
  #mutation = Promise.resolve();

  constructor(stateDirectory: string) {
    this.#path = resolve(stateDirectory, "resilience-certification.json");
  }

  async record(input: DurableResilienceObservation): Promise<DurableResilienceObservation> {
    validateObservation(input);
    return this.#mutate(async (state) => {
      const replay = state.observations.find((item) => item.requestId === input.requestId);
      if (replay) {
        if (JSON.stringify(replay) !== JSON.stringify(input)) throw new Error("Recovery evidence changed for an existing request.");
        return { state, result: replay };
      }
      const prior = state.observations.find((item) => item.projectId === input.projectId && item.scenario === input.scenario);
      if (prior) throw new Error("This recovery scenario already has evidence for the project.");
      return { state: { schemaVersion: 1, observations: [...state.observations, input] }, result: input };
    });
  }

  async list(projectId: string): Promise<readonly DurableResilienceObservation[]> {
    assertProjectId(projectId);
    return (await this.#load()).observations.filter((item) => item.projectId === projectId);
  }

  async certify(projectId: string): Promise<ResilienceCertification> {
    return certifyResilience(await this.list(projectId));
  }

  async #load(): Promise<ResilienceState> {
    try {
      const raw = JSON.parse(await readFile(this.#path, "utf8")) as unknown;
      if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.observations)) throw new Error();
      const observations = raw.observations.map((item) => {
        validateObservation(item as DurableResilienceObservation);
        return item as DurableResilienceObservation;
      });
      return { schemaVersion: 1, observations };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, observations: [] };
      throw new Error("Resilience evidence is unreadable. Restore or remove the exact state file before continuing.");
    }
  }

  async #save(state: ResilienceState) {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600);
  }

  async #mutate<T>(operation: (state: ResilienceState) => Promise<{ state: ResilienceState; result: T }>): Promise<T> {
    let result!: T;
    const run = this.#mutation.then(async () => {
      const update = await operation(await this.#load());
      await this.#save(update.state);
      result = update.result;
    });
    this.#mutation = run.catch(() => undefined);
    await run;
    return result;
  }
}

function validateObservation(input: DurableResilienceObservation) {
  if (!isRecord(input) || input.schemaVersion !== 1) throw new Error("Recovery evidence schema is invalid.");
  assertProjectId(input.projectId);
  if (!requestPattern.test(input.requestId)) throw new Error("Recovery evidence request identity is invalid.");
  if (!isScenario(input.scenario)) throw new Error("Recovery scenario is invalid.");
  if (!digestPattern.test(input.beforeDigest) || !digestPattern.test(input.afterDigest)) throw new Error("Recovery state digest is invalid.");
  if (!receiptPattern.test(input.recoveryReceipt)) throw new Error("Recovery receipt is invalid.");
  if (!Number.isInteger(input.observedAt) || input.observedAt < 0) throw new Error("Recovery observation time is invalid.");
  if (!Number.isInteger(input.duplicateEffects) || input.duplicateEffects < 0) throw new Error("Duplicate effect count is invalid.");
  if (typeof input.blocker !== "string" || typeof input.smallestOwnerAction !== "string" || typeof input.evidenceRef !== "string") throw new Error("Recovery explanation is invalid.");
  if (typeof input.safeStatePreserved !== "boolean" || typeof input.restartObserved !== "boolean" || typeof input.resumed !== "boolean") throw new Error("Recovery outcome is invalid.");
}

function assertProjectId(projectId: string) {
  if (!projectPattern.test(projectId)) throw new Error("Project identity is invalid.");
}

function isScenario(value: unknown): value is ResilienceScenario {
  return ["process_crash", "stale_lease", "provider_failure", "free_provider_exhaustion", "malformed_model_output", "connector_denial", "jira_conflict", "invalid_attachment", "reviewer_dissent", "deployment_failure", "owner_timeout"].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
