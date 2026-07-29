import type { ProviderAdapter } from "../../../packages/providers/src/index.js";
import type { ProviderConnectionRepository } from "../../../packages/providers/src/lifecycle.js";
import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";
import type {
  LocalProposalGeneration,
  LocalProposalImport,
  LocalRequest,
} from "../../../packages/runtime/src/local-requests.js";
import { ProviderRuntimeService } from "./provider-service.js";
import {
  executeProposalAdapter,
  readPrivateProposalArtifact,
  writePrivateProposalArtifact,
} from "./local-proposal.js";
import { LocalRequestError, LocalRequestStore } from "./local-request-store.js";
import { ProviderCapacityStore } from "./provider-capacity-store.js";
import { resolve } from "node:path";

export interface ProposalAdapterRegistry {
  adapter(providerId: string): ProviderAdapter | null;
}

export class LocalProposalGenerator {
  readonly #runtime: ProviderRuntimeService;
  readonly #capacity: ProviderCapacityStore;
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  public constructor(
    private readonly stateDirectory: string,
    private readonly requests: LocalRequestStore,
    private readonly connections: ProviderConnectionRepository,
    private readonly vault: Pick<CredentialVault, "read">,
    private readonly adapters: ProposalAdapterRegistry,
    private readonly now: () => number = Date.now
  ) {
    this.#runtime = new ProviderRuntimeService(stateDirectory);
    this.#capacity = new ProviderCapacityStore(
      resolve(stateDirectory, "provider-capacity.json")
    );
  }

  public async schedule(requestId: string): Promise<LocalRequest> {
    let request = await this.#request(requestId);
    if (request.execution?.proposal?.state === "requested") {
      request = await this.requests.beginProposalGeneration(requestId);
    }
    const state = request.execution?.proposal?.state;
    if (!state || ["review_ready", "accepted", "rejected"].includes(state)) return request;
    const retryAt = request.execution?.proposal?.retryAt;
    if (retryAt !== null && retryAt !== undefined && retryAt > this.now()) {
      this.#scheduleRetry(requestId, retryAt);
      return request;
    }
    if (!this.#inFlight.has(requestId)) {
      const work = this.generate(requestId)
        .then(() => undefined)
        .catch(async (error: unknown) => {
          const current = await this.#request(requestId);
          const session = current.execution?.proposal;
          if (!session || ["review_ready", "accepted", "rejected"].includes(session.state)) return;
          await this.requests.recordProposalGeneration(requestId, {
            schemaVersion: 1,
            promptDigest: session.prompt.digest,
            state: "needs_user",
            attempts: session.generation?.attempts ?? [],
            selectedProviderId: null,
            selectedModelId: null,
            retryAt: null,
            safeMessage:
              error instanceof LocalRequestError
                ? error.message
                : "Proposal generation stopped safely. Inspect provider connections and retry.",
            updatedAt: this.now(),
          });
        })
        .finally(() => this.#inFlight.delete(requestId));
      this.#inFlight.set(requestId, work);
    }
    return request;
  }

  public async resumePending(): Promise<number> {
    const requests = (await this.requests.list()).requests.filter((request) =>
      ["requested", "generating", "deferred", "interrupted"].includes(
        request.execution?.proposal?.state ?? ""
      )
    );
    for (const request of requests) await this.schedule(request.id);
    return requests.length;
  }

  #scheduleRetry(requestId: string, retryAt: number): void {
    const current = this.#timers.get(requestId);
    if (current) clearTimeout(current);
    const delay = Math.min(Math.max(1, retryAt - this.now()), 2_147_000_000);
    const timer = setTimeout(() => {
      this.#timers.delete(requestId);
      void this.schedule(requestId);
    }, delay);
    timer.unref();
    this.#timers.set(requestId, timer);
  }

  public async generate(requestId: string): Promise<LocalRequest> {
    let request = await this.#request(requestId);
    const session = request.execution?.proposal;
    if (!session) {
      throw new LocalRequestError("invalid_transition", "Compile a grounded proposal first.");
    }
    if (session.state === "review_ready" || session.state === "accepted" || session.state === "rejected") {
      return request;
    }
    if (session.state === "requested") {
      request = await this.requests.beginProposalGeneration(requestId);
    }
    const active = request.execution?.proposal;
    if (!active || !["generating", "deferred", "interrupted", "needs_user"].includes(active.state)) {
      throw new LocalRequestError("invalid_transition", "Proposal generation is not resumable.");
    }
    if (active.retryAt !== null && active.retryAt > this.now()) return request;

    const now = this.now();
    const connections = await this.connections.list();
    const capacity = await this.#capacity.snapshot(
      connections.map((connection) => connection.id),
      now
    );
    const usageByConnectionId = capacity.usageByConnectionId;
    const priorityByConnectionId = Object.fromEntries(
      [...connections]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((connection, index) => [connection.id, index + 1])
    );
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const artifacts = resolve(this.stateDirectory, "proposal-artifacts", requestId);

    const outcome = await this.#runtime.executeAdmitted({
      taskId: requestId,
      workUnitId: `proposal-${active.prompt.digest.slice(0, 24)}`,
      requestDigest: active.prompt.digest,
      connections,
      priorityByConnectionId,
      usageByConnectionId,
      circuitOpenUntilByConnectionId: capacity.circuitOpenUntilByConnectionId,
      requiredCapabilities: ["chat", "structured_output"],
      routeRequest: {
        role: "implementer",
        kind: "code",
        dataClass: "source_code",
        minimumPrivacy: "training_eligible",
        estimatedInputTokens: estimatePromptTokens(active.prompt),
        requestedOutputTokens: 8_192,
        allowPaid: false,
        allowPromotionalCredit: false,
        now,
      },
      executor: {
        execute: async ({ candidate }) => {
          const connectionId = candidate.providerConnectionId;
          const connection = connectionId ? connectionById.get(connectionId) : null;
          if (!connection) {
            throw Object.assign(new Error("Selected provider connection disappeared."), {
              code: "connection-missing",
              status: 403,
            });
          }
          const adapter = this.adapters.adapter(candidate.providerId);
          if (!adapter || adapter.manifest.providerId !== candidate.providerId) {
            throw Object.assign(new Error("Selected provider adapter is unavailable."), {
              code: "adapter-missing",
              status: 503,
            });
          }
          const secret = await this.vault.read(connection.credentialReference);
          if (!secret) {
            throw Object.assign(new Error("Provider credential is unavailable."), {
              code: "credential-missing",
              status: 401,
            });
          }
          let imported: LocalProposalImport;
          try {
            imported = await executeProposalAdapter({
              adapter,
              credential: { secret },
              prompt: active.prompt,
              modelId: candidate.modelId,
              maxOutputTokens: Math.min(8_192, candidate.maxOutputTokens),
            });
          } finally {
            // Keep the credential scoped to this call; it is never copied into evidence.
          }
          const digest = await writePrivateProposalArtifact({
            directory: artifacts,
            response: imported.response,
          });
          return {
            outputDigest: `sha256:${digest}`,
            inputTokens: imported.inputTokens,
            outputTokens: imported.outputTokens,
          };
        },
      },
    });

    if (outcome.state === "held") {
      const held = await this.requests.recordProposalGeneration(
        requestId,
        heldEvidence(active.prompt.digest, outcome.retryAt, outcome.excluded, now)
      );
      if (outcome.retryAt !== null) this.#scheduleRetry(requestId, outcome.retryAt);
      return held;
    }

    await this.#capacity.record(
      outcome.result.projection,
      Object.fromEntries(
        outcome.result.route.eligible.flatMap((candidate) =>
          candidate.providerConnectionId
            ? [[candidate.id, candidate.providerConnectionId]]
            : []
        )
      ),
      now
    );
    const evidence = projectionEvidence(active.prompt.digest, outcome.result.projection, now);
    if (outcome.result.projection.status !== "succeeded") {
      const recorded = await this.requests.recordProposalGeneration(requestId, evidence);
      if (evidence.retryAt !== null) this.#scheduleRetry(requestId, evidence.retryAt);
      return recorded;
    }
    const digest = outcome.result.projection.outputDigest?.replace(/^sha256:/, "");
    const succeeded = [...outcome.result.projection.attempts]
      .reverse()
      .find((attempt) => attempt.status === "succeeded");
    if (!digest || !succeeded || succeeded.inputTokens === null || succeeded.outputTokens === null) {
      throw new LocalRequestError("store_invalid", "Provider success evidence is incomplete.");
    }
    await this.requests.recordProposalGeneration(requestId, evidence);
    const response = await readPrivateProposalArtifact({ directory: artifacts, digest });
    return this.requests.importProposal(requestId, {
      schemaVersion: 1,
      expectedPromptDigest: active.prompt.digest,
      providerId: succeeded.providerId,
      modelId: succeeded.modelId,
      response,
      inputTokens: succeeded.inputTokens,
      outputTokens: succeeded.outputTokens,
    });
  }

  async #request(requestId: string) {
    const request = (await this.requests.list()).requests.find((item) => item.id === requestId);
    if (!request) throw new LocalRequestError("not_found", "Request was not found.");
    return request;
  }
}

function estimatePromptTokens(prompt: { system: string; instruction: string; sources: readonly { content: string }[] }): number {
  const characters =
    prompt.system.length +
    prompt.instruction.length +
    prompt.sources.reduce((total, source) => total + source.content.length, 0);
  return Math.max(1, Math.ceil(characters / 4));
}

function heldEvidence(
  promptDigest: string,
  retryAt: number | null,
  excluded: readonly { connectionId: string; decision: { reason: string; detail: string } }[],
  now: number
): LocalProposalGeneration {
  const deferred = retryAt !== null;
  return {
    schemaVersion: 1,
    promptDigest,
    state: deferred ? "deferred" : "needs_user",
    attempts: [],
    selectedProviderId: null,
    selectedModelId: null,
    retryAt,
    safeMessage: deferred
      ? "Every eligible free route is temporarily unavailable. The prompt is preserved until the next safe retry."
      : excluded[0]?.decision.detail ?? "Connect and verify one free provider before generating.",
    updatedAt: now,
  };
}

function projectionEvidence(
  promptDigest: string,
  projection: Awaited<ReturnType<ProviderRuntimeService["execute"]>>["projection"],
  now: number
): LocalProposalGeneration {
  const attempts = projection.attempts.map((attempt) => ({
    candidateId: attempt.candidateId,
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    state: attempt.status,
    failureCode: attempt.failureCode,
    retryAt: attempt.retryAt,
  }));
  const succeeded = [...projection.attempts].reverse().find((attempt) => attempt.status === "succeeded");
  const state = projection.status === "succeeded"
    ? "succeeded"
    : projection.status === "deferred"
      ? "deferred"
      : projection.status === "needs_user"
        ? "needs_user"
        : "running";
  return {
    schemaVersion: 1,
    promptDigest,
    state,
    attempts,
    selectedProviderId: succeeded?.providerId ?? null,
    selectedModelId: succeeded?.modelId ?? null,
    retryAt: projection.retryAt,
    safeMessage:
      state === "succeeded"
        ? "One free-provider response completed and is being validated as untrusted proposal data."
        : projection.statusReason ?? "Free-provider generation is in progress.",
    updatedAt: now,
  };
}
