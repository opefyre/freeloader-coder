import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import {
  emptyCapacityUsage,
  recordCapacityUsage,
  recordCircuitFailure,
  recordCircuitSuccess,
  type CapacityUsageState,
} from "../../../packages/providers/src/circuit.js";
import type { ProviderCapacityUsage } from "../../../packages/providers/src/router.js";
import type { ProviderJournalProjection } from "../../../packages/storage/src/provider-journal.js";

const circuitSchema = z.strictObject({
  consecutiveFailures: z.number().int().nonnegative(),
  openUntil: z.number().int().nonnegative(),
  lastFailureAt: z.number().int().nonnegative().nullable(),
  lastFailureCode: z.string().max(120).nullable(),
});
const usageSchema = z.strictObject({
  utcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestsToday: z.number().int().nonnegative(),
  inputTokensToday: z.number().int().nonnegative(),
  outputTokensToday: z.number().int().nonnegative(),
  freeUnitsToday: z.number().nonnegative(),
  requestTimestamps: z.array(z.number().int().nonnegative()).max(10_000),
  tokenSamples: z.array(z.strictObject({
    at: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
  })).max(10_000),
  providerRemainingRequests: z.number().int().nonnegative().nullable(),
  providerRemainingTokens: z.number().int().nonnegative().nullable(),
  providerResetAt: z.number().int().nonnegative().nullable(),
});
const entrySchema = z.strictObject({
  usage: usageSchema,
  circuit: circuitSchema,
  recordedAttempts: z.array(z.string().min(1).max(160)).max(50_000),
});
const documentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  connections: z.record(z.string(), entrySchema),
});
type Document = z.infer<typeof documentSchema>;

export class ProviderCapacityStore {
  private mutation: Promise<void> = Promise.resolve();

  public constructor(private readonly path: string) {}

  public async snapshot(
    connectionIds: readonly string[],
    now: number
  ): Promise<{
    usageByConnectionId: Readonly<Record<string, ProviderCapacityUsage>>;
    circuitOpenUntilByConnectionId: Readonly<Record<string, number>>;
  }> {
    const document = await this.load();
    const usageByConnectionId: Record<string, ProviderCapacityUsage> = {};
    const circuitOpenUntilByConnectionId: Record<string, number> = {};
    for (const id of connectionIds) {
      const entry = document.connections[id] ?? freshEntry(now);
      const usage = entry.usage.utcDay === utcDay(now) ? entry.usage : emptyCapacityUsage(now);
      usageByConnectionId[id] = toProviderUsage(usage);
      circuitOpenUntilByConnectionId[id] = isContractLocalFailure(entry.circuit.lastFailureCode)
        ? 0
        : entry.circuit.openUntil;
    }
    return { usageByConnectionId, circuitOpenUntilByConnectionId };
  }

  public async record(
    projection: ProviderJournalProjection,
    candidateConnectionIds: Readonly<Record<string, string>>,
    now: number
  ): Promise<void> {
    const document = await this.load();
    for (const attempt of projection.attempts) {
      const connectionId = candidateConnectionIds[attempt.candidateId];
      if (!connectionId) continue;
      const entry = document.connections[connectionId] ?? freshEntry(now);
      if (attempt.status === "started") {
        continue;
      }
      if (entry.recordedAttempts.includes(attempt.idempotencyKey)) {
        const deterministicFailure = attempt.status === "failed" && !isContractLocalFailure(attempt.failureCode) && ![
          "capacity_deferred",
          "gateway_interrupted",
          "rate_limit",
          "transient_provider",
        ].includes(attempt.failureClass ?? "");
        if (deterministicFailure && entry.circuit.openUntil <= now) {
          entry.circuit = recordCircuitFailure({
            state: entry.circuit,
            now,
            threshold: 1,
            cooldownMs: 10 * 60_000,
            transient: true,
            ...(attempt.failureCode ? { code: attempt.failureCode } : {}),
          });
          document.connections[connectionId] = entry;
        }
        continue;
      }
      const usage = recordCapacityUsage({
        state: entry.usage,
        now: attempt.finishedAt ?? now,
        inputTokens: attempt.inputTokens ?? 0,
        outputTokens: attempt.outputTokens ?? 0,
      });
      entry.usage = {
        ...usage,
        requestTimestamps: [...usage.requestTimestamps],
        tokenSamples: usage.tokenSamples.map((sample) => ({ ...sample })),
      };
      const transientFailure = [
        "capacity_deferred",
        "gateway_interrupted",
        "rate_limit",
        "transient_provider",
      ].includes(attempt.failureClass ?? "");
      entry.circuit =
        attempt.status === "succeeded"
          ? recordCircuitSuccess()
          : isContractLocalFailure(attempt.failureCode)
            ? (isContractLocalFailure(entry.circuit.lastFailureCode) ? recordCircuitSuccess() : entry.circuit)
          : recordCircuitFailure({
              state: entry.circuit,
              now: attempt.finishedAt ?? now,
              threshold: transientFailure ? 2 : 1,
              cooldownMs: transientFailure
                ? Math.max(1_000, (attempt.retryAt ?? ((attempt.finishedAt ?? now) + 5 * 60_000)) - (attempt.finishedAt ?? now))
                : 10 * 60_000,
              // A deterministic rejection is not transient for this route, but it
              // must still be cooled down so the scheduler can try another free
              // provider instead of selecting the same incompatible route forever.
              transient: true,
              ...(attempt.failureCode ? { code: attempt.failureCode } : {}),
            });
      entry.recordedAttempts.push(attempt.idempotencyKey);
      document.connections[connectionId] = entry;
    }
    await this.save(document);
  }

  public async recordGatewayAttempt(input: {
    readonly connectionId: string;
    readonly attemptId: string;
    readonly now: number;
    readonly succeeded: boolean;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly failureCode?: string | undefined;
    readonly retryAt?: number | null | undefined;
  }): Promise<void> {
    const operation = this.mutation.then(async () => {
      const document = await this.load();
      const entry = document.connections[input.connectionId] ?? freshEntry(input.now);
      if (entry.recordedAttempts.includes(input.attemptId)) return;
      const usage = recordCapacityUsage({
        state: entry.usage,
        now: input.now,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        ...(input.retryAt !== undefined ? { providerResetAt: input.retryAt } : {}),
      });
      entry.usage = {
        ...usage,
        requestTimestamps: [...usage.requestTimestamps],
        tokenSamples: usage.tokenSamples.map((sample) => ({ ...sample })),
      };
      entry.circuit = input.succeeded
        ? recordCircuitSuccess()
        : recordCircuitFailure({
            state: entry.circuit,
            now: input.now,
            threshold: 2,
            cooldownMs: Math.max(60_000, (input.retryAt ?? 0) - input.now),
            transient: ["rate_limited", "timeout", "provider_unavailable", "unknown"].includes(input.failureCode ?? ""),
            ...(input.failureCode ? { code: input.failureCode } : {}),
          });
      entry.recordedAttempts.push(input.attemptId);
      document.connections[input.connectionId] = entry;
      await this.save(document);
    });
    this.mutation = operation.catch(() => undefined);
    return operation;
  }

  public async recordProbeSuccess(connectionId: string, now: number): Promise<void> {
    const operation = this.mutation.then(async () => {
      const document = await this.load();
      const entry = document.connections[connectionId] ?? freshEntry(now);
      entry.circuit = recordCircuitSuccess();
      document.connections[connectionId] = entry;
      await this.save(document);
    });
    this.mutation = operation.catch(() => undefined);
    return operation;
  }

  private async load(): Promise<Document> {
    try {
      return documentSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return { schemaVersion: 1, connections: {} };
      throw error;
    }
  }

  private async save(document: Document): Promise<void> {
    const parsed = documentSchema.parse(document);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.path), 0o700);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, this.path);
    await chmod(this.path, 0o600);
  }
}

function isContractLocalFailure(code: string | null): boolean {
  return ["malformed-response", "response-contract-rejected", "unsafe-citation"].includes(code ?? "");
}

function freshEntry(now: number): z.infer<typeof entrySchema> {
  const usage = emptyCapacityUsage(now);
  return {
    usage: {
      ...usage,
      requestTimestamps: [...usage.requestTimestamps],
      tokenSamples: usage.tokenSamples.map((sample) => ({ ...sample })),
    },
    circuit: recordCircuitSuccess(),
    recordedAttempts: [],
  };
}

function toProviderUsage(state: CapacityUsageState): ProviderCapacityUsage {
  return {
    activeRequests: 0,
    requestsToday: state.requestsToday,
    tokensToday: state.inputTokensToday + state.outputTokensToday,
    inputTokensToday: state.inputTokensToday,
    outputTokensToday: state.outputTokensToday,
    freeUnitsToday: state.freeUnitsToday,
    requestTimestamps: state.requestTimestamps,
    tokenSamples: state.tokenSamples,
    providerRemainingRequests: state.providerRemainingRequests,
    providerRemainingTokens: state.providerRemainingTokens,
    providerResetAt: state.providerResetAt,
  };
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
