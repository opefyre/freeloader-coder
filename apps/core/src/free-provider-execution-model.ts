import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { ExecutionCandidate } from "../../../packages/orchestration/src/project-execution.js";
import type { ProjectEgressPermit } from "../../../packages/orchestration/src/solution-design.js";
import type { ProviderAdapter } from "../../../packages/providers/src/adapter.js";
import type {
  CredentialVault,
  ProviderConnectionRepository,
} from "../../../packages/providers/src/lifecycle.js";
import {
  readPrivateProposalArtifact,
  writePrivateProposalArtifact,
} from "./local-proposal.js";
import { ProviderCapacityStore } from "./provider-capacity-store.js";
import { ProviderRuntimeService } from "./provider-service.js";

const SENSITIVE =
  /(?:api[_-]?key|password|private[_-]?key|access[_-]?token)["']?\s*[:=]\s*\\?["']?\S+|secret["']?\s*[:=]\s*\\?["']?(?:sk[-_]|gh[pousr]_|AIza|eyJ)[A-Za-z0-9._+=/-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\/Users\/[^/\s]+\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export class FreeProviderExecutionModel {
  readonly #runtime: ProviderRuntimeService;
  readonly #capacity: ProviderCapacityStore;
  #refreshInFlight: Promise<void> | null = null;
  readonly #lastRefreshAttemptAt = new Map<string, number>();
  constructor(
    private readonly stateDirectory: string,
    private readonly connections: Pick<
      ProviderConnectionRepository,
      "read" | "list"
    >,
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly adapters: {
      adapter(providerId: string): ProviderAdapter | null;
    },
    private readonly now: () => number = Date.now,
    private readonly refresher?: {
      reProbe(id: string, now?: number): Promise<unknown>;
    },
  ) {
    this.#runtime = new ProviderRuntimeService(stateDirectory);
    this.#capacity = new ProviderCapacityStore(
      resolve(stateDirectory, "provider-capacity.json"),
    );
  }

  async candidates(
    permit: ProjectEgressPermit,
    role: "implementer" | "reviewer",
  ): Promise<readonly ExecutionCandidate[]> {
    const now = this.now();
    let connections = await this.connections.list();
    const stale = connections.filter(
      (connection) =>
        permit.providerIds.includes(connection.providerId) &&
        connection.credentialState === "active" &&
        (connection.state === "stale" ||
          connection.cost.expiresAt <= now ||
          connection.quota.expiresAt <= now ||
          connection.canary.expiresAt <= now) &&
        now - (this.#lastRefreshAttemptAt.get(connection.id) ?? 0) >=
          5 * 60_000,
    );
    if (stale.length && this.refresher) {
      for (const connection of stale)
        this.#lastRefreshAttemptAt.set(connection.id, now);
      await this.#refresh(
        stale.map((connection) => connection.id),
        now,
      );
      connections = await this.connections.list();
    }
    const capacity = await this.#capacity.snapshot(
      connections.map((connection) => connection.id),
      now,
    );
    return connections
      .filter(
        (connection) =>
          permit.expiresAt > now &&
          permit.providerIds.includes(connection.providerId) &&
          connection.capabilityRoles.includes(role) &&
          connection.credentialState === "active" &&
          connection.state === "ready" &&
          connection.cost.zeroCost &&
          !connection.cost.billingEnabled &&
          connection.cost.expiresAt > now &&
          connection.quota.expiresAt > now &&
          connection.canary.expiresAt > now &&
          connection.canary.status === "passed" &&
          (connection.quota.remainingRequests === null ||
            connection.quota.remainingRequests > 0) &&
          (connection.quota.remainingTokens === null ||
            connection.quota.remainingTokens > 0) &&
          (capacity.circuitOpenUntilByConnectionId[connection.id] ?? 0) <= now,
      )
      .map((connection, index) => ({
        providerId: connection.providerId,
        modelId: connection.modelId,
        deviceId: `provider:${connection.id}`,
        capabilities: connection.canary.capabilities,
        privacyClasses: [permit.dataClass],
        quotaAvailable: true,
        billingEnabled: false,
        activeRequests:
          capacity.usageByConnectionId[connection.id]?.activeRequests ?? 0,
        safeConcurrency: 1,
        availableMemoryMb: 1,
        requiredMemoryMb: 0,
        deviceLoad: 0,
        preference: Math.max(0, 1_000 - index),
      }));
  }

  async run(input: {
    projectId: string;
    taskId: string;
    assignment: { providerId: string; modelId: string; deviceId: string };
    role: "implementer" | "reviewer";
    permit: ProjectEgressPermit;
    system: string;
    instruction: string;
    sources: readonly { name: string; content: string }[];
    responseSchema: Readonly<Record<string, unknown>>;
    maxOutputTokens?: number;
  }) {
    const now = this.now();
    if (
      input.permit.projectId !== input.projectId ||
      input.permit.expiresAt <= now ||
      !input.permit.providerIds.includes(input.assignment.providerId)
    )
      throw new FreeProviderExecutionError(
        "consent_denied",
        null,
        "Project provider consent is missing, stale, or does not include the assigned provider.",
      );
    if (!input.assignment.deviceId.startsWith("provider:"))
      throw new FreeProviderExecutionError(
        "assignment_invalid",
        null,
        "Execution assignment does not identify a verified provider connection.",
      );
    const connectionId = input.assignment.deviceId.slice("provider:".length);
    const connection = await this.connections.read(connectionId);
    if (
      !connection ||
      connection.providerId !== input.assignment.providerId ||
      connection.modelId !== input.assignment.modelId ||
      !connection.capabilityRoles.includes(input.role)
    )
      throw new FreeProviderExecutionError(
        "assignment_invalid",
        null,
        "Assigned provider connection changed before execution.",
      );
    const candidates = await this.candidates(input.permit, input.role);
    if (
      !candidates.some(
        (candidate) => candidate.deviceId === input.assignment.deviceId,
      )
    )
      throw new FreeProviderExecutionError(
        "capacity_unavailable",
        connection.quota.resetAt,
        "Assigned free provider is no longer eligible. Work remains queued for a safe retry.",
      );
    const payload = JSON.stringify(input.sources);
    if (payload.length > 900_000 || SENSITIVE.test(payload))
      throw new FreeProviderExecutionError(
        "source_denied",
        null,
        "Bounded source evidence contains sensitive or oversized material.",
      );
    const requestDigest = hash(
      JSON.stringify({
        projectId: input.projectId,
        taskId: input.taskId,
        assignment: input.assignment,
        role: input.role,
        instruction: input.instruction,
        sourceDigests: input.sources.map((source) => [
          source.name,
          hash(source.content),
        ]),
      }),
    );
    const capacity = await this.#capacity.snapshot([connection.id], now);
    const directory = resolve(
      this.stateDirectory,
      "execution-model-artifacts",
      input.projectId,
      input.taskId,
      input.role,
    );
    const outcome = await this.#runtime.executeAdmitted({
      taskId: input.taskId,
      workUnitId: `${input.role}-${requestDigest.slice(0, 20)}`,
      requestDigest,
      connections: [connection],
      priorityByConnectionId: { [connection.id]: 1 },
      usageByConnectionId: capacity.usageByConnectionId,
      circuitOpenUntilByConnectionId: capacity.circuitOpenUntilByConnectionId,
      requiredCapabilities: ["chat", "structured_output"],
      routeRequest: {
        role: input.role,
        kind: input.role === "reviewer" ? "review" : "code",
        dataClass: input.permit.dataClass,
        minimumPrivacy: "training_eligible",
        estimatedInputTokens: Math.max(1, Math.ceil(payload.length / 4)),
        requestedOutputTokens: Math.min(
          connection.maxOutputTokens,
          input.maxOutputTokens ?? 16_384,
        ),
        allowPaid: false,
        allowPromotionalCredit: false,
        preferredProviderIds: [connection.providerId],
        avoidedProviderIds: [],
        now,
      },
      executor: {
        execute: async ({ candidate }) => {
          if (
            candidate.providerConnectionId !== connection.id ||
            candidate.providerId !== input.assignment.providerId ||
            candidate.modelId !== input.assignment.modelId ||
            candidate.paid ||
            candidate.billingMode !== "free_tier"
          )
            throw failure("assignment-mismatch", 403);
          const adapter = this.adapters.adapter(candidate.providerId);
          const secret = await this.vault.read(connection.credentialReference);
          if (!adapter || !secret) throw failure("provider-unavailable", 503);
          const response = await adapter.chat(
            { secret },
            {
              requestId: `execution-${requestDigest.slice(0, 24)}`,
              modelId: candidate.modelId,
              messages: [
                { role: "system", content: input.system },
                {
                  role: "user",
                  content: `${input.instruction}\n\nBOUNDED SOURCES:\n${payload}`,
                },
              ],
              maxOutputTokens: Math.min(
                candidate.maxOutputTokens,
                input.maxOutputTokens ?? 16_384,
              ),
              temperature: 0,
              responseSchema: providerResponseSchema(
                candidate.providerId,
                input.responseSchema,
              ),
              tools: [],
              timeoutMs: 180_000,
            },
          );
          if (
            response.finishReason !== "stop" ||
            response.toolCalls.length ||
            response.verified ||
            SENSITIVE.test(response.content)
          )
            throw failure("malformed-response", 400);
          JSON.parse(response.content);
          const artifactDigest = await writePrivateProposalArtifact({
            directory,
            response: response.content,
          });
          return {
            outputDigest: `sha256:${artifactDigest}`,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          };
        },
      },
    });
    if (outcome.state === "held")
      throw new FreeProviderExecutionError(
        "capacity_unavailable",
        outcome.retryAt,
        outcome.excluded[0]?.decision.detail ??
          "Assigned free provider is temporarily unavailable.",
      );
    await this.#capacity.record(
      outcome.result.projection,
      { [outcome.result.route.eligible[0]?.id ?? ""]: connection.id },
      now,
    );
    if (outcome.result.projection.status !== "succeeded")
      throw new FreeProviderExecutionError(
        "provider_failed",
        outcome.result.projection.retryAt,
        outcome.result.projection.statusReason ??
          "Assigned free provider did not complete.",
      );
    const attempt = [...outcome.result.projection.attempts]
      .reverse()
      .find((candidate) => candidate.status === "succeeded");
    const artifactDigest = outcome.result.projection.outputDigest?.replace(
      /^sha256:/,
      "",
    );
    if (!attempt || !artifactDigest)
      throw new FreeProviderExecutionError(
        "evidence_incomplete",
        null,
        "Free-provider execution evidence is incomplete.",
      );
    return {
      providerId: attempt.providerId,
      modelId: attempt.modelId,
      response: JSON.parse(
        await readPrivateProposalArtifact({
          directory,
          digest: artifactDigest,
        }),
      ),
      artifactDigest,
    };
  }

  async #refresh(ids: readonly string[], now: number) {
    if (!this.#refreshInFlight)
      this.#refreshInFlight = Promise.allSettled(
        [...new Set(ids)].map((id) => this.refresher!.reProbe(id, now)),
      )
        .then(() => undefined)
        .finally(() => {
          this.#refreshInFlight = null;
        });
    await this.#refreshInFlight;
  }
}

export class FreeProviderExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryAt: number | null,
    message: string,
  ) {
    super(message);
  }
}
function failure(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const COHERE_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "pattern",
]);
function providerResponseSchema(
  providerId: string,
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (providerId !== "cohere") return schema;
  return stripUnsupportedSchemaKeywords(schema) as Readonly<
    Record<string, unknown>
  >;
}
function stripUnsupportedSchemaKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupportedSchemaKeywords);
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !COHERE_UNSUPPORTED_SCHEMA_KEYWORDS.has(key))
      .map(([key, nested]) => [key, stripUnsupportedSchemaKeywords(nested)]),
  );
  if (!("type" in normalized) && Array.isArray(normalized.enum)) {
    const types = [
      ...new Set(
        normalized.enum
          .filter((item) => item !== null)
          .map((item) => typeof item),
      ),
    ];
    if (
      types.length === 1 &&
      ["string", "number", "boolean"].includes(types[0] ?? "")
    )
      normalized.type = types[0];
  }
  return normalized;
}
