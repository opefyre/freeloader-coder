import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { join } from "node:path";

import {
  executeProviderTask,
  type ProviderExecutor,
  type ProviderTaskRuntimeResult
} from "../../../packages/orchestration/src/provider-runtime.js";
import type { ProviderConnection } from "../../../packages/schemas/src/index.js";
import {
  resolveAdmittedProviderCandidates,
  type ProviderCapability,
  type ProviderCapacityUsage,
  type ProviderCandidate,
  type RouteRequest
} from "../../../packages/providers/src/index.js";
import { JsonProviderJournalStore } from "../../../packages/storage/src/provider-journal.js";

export class ProviderRuntimeService {
  public constructor(
    private readonly stateDirectory: string,
    private readonly leaseDurationMs = 60_000
  ) {
    if (!stateDirectory) throw new Error("Provider runtime state directory is required.");
    if (leaseDurationMs < 3_000) throw new Error("Provider lease duration is too short.");
  }

  public async execute(input: {
    readonly taskId: string;
    readonly workUnitId: string;
    readonly requestDigest: string;
    readonly candidates: readonly ProviderCandidate[];
    readonly routeRequest: RouteRequest;
    readonly executor: ProviderExecutor;
  }): Promise<ProviderTaskRuntimeResult> {
    const taskId = safeSegment(input.taskId);
    const workUnitId = safeSegment(input.workUnitId);
    const taskDirectory = join(this.stateDirectory, "provider-journals", taskId);
    await mkdir(taskDirectory, { recursive: true });
    const lease = await FileTaskLease.acquire({
      path: join(taskDirectory, `${workUnitId}.lock`),
      durationMs: this.leaseDurationMs
    });
    try {
      return await executeProviderTask({
        ...input,
        repository: new JsonProviderJournalStore(join(taskDirectory, `${workUnitId}.json`))
      });
    } finally {
      await lease.release();
    }
  }

  public async executeAdmitted(input: {
    readonly taskId: string;
    readonly workUnitId: string;
    readonly requestDigest: string;
    readonly connections: readonly ProviderConnection[];
    readonly priorityByConnectionId: Readonly<Record<string, number>>;
    readonly usageByConnectionId: Readonly<Record<string, ProviderCapacityUsage>>;
    readonly requiredCapabilities: readonly ProviderCapability[];
    readonly routeRequest: RouteRequest;
    readonly executor: ProviderExecutor;
  }): Promise<
    | {
        readonly state: "executed";
        readonly result: ProviderTaskRuntimeResult;
      }
    | {
        readonly state: "held";
        readonly retryAt: number | null;
        readonly excluded: ReturnType<typeof resolveAdmittedProviderCandidates>["excluded"];
      }
  > {
    const resolution = resolveAdmittedProviderCandidates({
      connections: input.connections,
      now: input.routeRequest.now,
      requiredCapabilities: input.requiredCapabilities,
      priorityByConnectionId: input.priorityByConnectionId,
      usageByConnectionId: input.usageByConnectionId
    });
    if (resolution.candidates.length === 0) {
      const retryAt = resolution.excluded
        .map((entry) => entry.decision.retryAt)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0] ?? null;
      return {
        state: "held",
        retryAt,
        excluded: resolution.excluded
      };
    }
    const result = await this.execute({
      taskId: input.taskId,
      workUnitId: input.workUnitId,
      requestDigest: input.requestDigest,
      candidates: resolution.candidates,
      routeRequest: input.routeRequest,
      executor: input.executor
    });
    return { state: "executed", result };
  }
}

interface LeaseDocument {
  readonly ownerId: string;
  readonly expiresAt: number;
}

class FileTaskLease {
  private renewal: ReturnType<typeof setInterval> | null = null;
  private renewalFailure: Error | null = null;

  private constructor(
    private readonly path: string,
    private readonly ownerId: string,
    private readonly durationMs: number,
    private readonly handle: FileHandle
  ) {
    this.renewal = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        this.renewalFailure = error instanceof Error ? error : new Error("Lease renewal failed.");
      });
    }, Math.floor(durationMs / 3));
    this.renewal.unref();
  }

  public static async acquire(input: {
    readonly path: string;
    readonly durationMs: number;
  }): Promise<FileTaskLease> {
    const ownerId = randomUUID();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const handle = await open(input.path, "wx", 0o600);
        const lease = new FileTaskLease(input.path, ownerId, input.durationMs, handle);
        await lease.refresh();
        return lease;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        const current = await readLease(input.path);
        if (current && current.expiresAt > Date.now()) {
          throw new Error("Provider task has an active execution lease.");
        }
        const stalePath = `${input.path}.stale-${ownerId}`;
        try {
          await rename(input.path, stalePath);
          await unlink(stalePath);
        } catch (renameError) {
          if (!hasCode(renameError, "ENOENT")) throw renameError;
        }
      }
    }
    throw new Error("Provider task lease could not be acquired safely.");
  }

  public async release(): Promise<void> {
    if (this.renewal) clearInterval(this.renewal);
    this.renewal = null;
    await this.handle.close();
    const current = await readLease(this.path);
    if (current?.ownerId !== this.ownerId) {
      throw new Error("Provider task lease ownership changed before release.");
    }
    await unlink(this.path);
    if (this.renewalFailure) throw this.renewalFailure;
  }

  private async refresh(): Promise<void> {
    const document: LeaseDocument = {
      ownerId: this.ownerId,
      expiresAt: Date.now() + this.durationMs
    };
    await this.handle.truncate(0);
    await this.handle.write(`${JSON.stringify(document)}\n`, 0, "utf8");
    await this.handle.sync();
  }
}

async function readLease(path: string): Promise<LeaseDocument | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "ownerId" in value &&
      "expiresAt" in value &&
      typeof value.ownerId === "string" &&
      typeof value.expiresAt === "number"
    ) {
      return { ownerId: value.ownerId, expiresAt: value.expiresAt };
    }
    return null;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value) || value.includes("..")) {
    throw new Error("Provider runtime identifier is unsafe.");
  }
  return value;
}
