import { createHash } from "node:crypto";

import {
  providerConnectionSchema,
  type ProviderCanaryEvidence,
  type ProviderConnection,
  type ProviderCostEvidence,
  type ProviderQuotaEvidence
} from "../../schemas/src/index.js";
import { catalogProvider } from "./catalog.js";
import {
  createAdmittedProviderCandidate,
  evaluateProviderAdmission,
  type ProviderAdmissionDecision,
  type ProviderCapability
} from "./connection.js";
import type {
  ProviderCandidate,
  ProviderCapacityUsage,
  PrivacyLevel
} from "./router.js";

export interface CredentialVault {
  write(reference: string, secret: string): Promise<void>;
  read(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}

export interface ProviderConnectionRepository {
  read(id: string): Promise<ProviderConnection | null>;
  write(connection: ProviderConnection): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<readonly ProviderConnection[]>;
}

export interface ProviderConnectionProbes {
  cost(input: {
    readonly providerId: string;
    readonly secret: string;
    readonly now: number;
  }): Promise<ProviderCostEvidence>;
  quota(input: {
    readonly providerId: string;
    readonly secret: string;
    readonly now: number;
  }): Promise<ProviderQuotaEvidence>;
  canary(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly secret: string;
    readonly now: number;
    readonly capabilities: readonly ProviderCapability[];
  }): Promise<ProviderCanaryEvidence>;
}

export interface ProviderConnectionResult {
  readonly connection: ProviderConnection;
  readonly admission: ProviderAdmissionDecision;
}

export interface ProviderCandidateResolution {
  readonly candidates: readonly ProviderCandidate[];
  readonly excluded: readonly {
    readonly connectionId: string;
    readonly decision: ProviderAdmissionDecision;
  }[];
}

export class ProviderConnectionLifecycle {
  public constructor(
    private readonly vault: CredentialVault,
    private readonly repository: ProviderConnectionRepository,
    private readonly probes: ProviderConnectionProbes
  ) {}

  public async connect(input: {
    readonly id: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly secret: string;
    readonly now: number;
    readonly capabilities: readonly ProviderCapability[];
    readonly roles?: readonly ("planner" | "implementer" | "reviewer")[] | undefined;
    readonly privacyClass?: PrivacyLevel | undefined;
  }): Promise<ProviderConnectionResult> {
    validateConnectionId(input.id);
    if (input.secret.trim().length < 8) {
      throw new ProviderConnectionLifecycleError(
        "invalid-credential",
        "The key is too short. Copy a complete provider API key and try again."
      );
    }
    const provider = catalogProvider(input.providerId);
    const model = provider.models.find((candidate) => candidate.id === input.modelId);
    if (!model) {
      throw new ProviderConnectionLifecycleError(
        "model-unavailable",
        "Choose a model from the verified provider catalogue."
      );
    }
    const credentialReference = `vault:providers/${provider.id}/${input.id}`;
    await this.vault.write(credentialReference, input.secret);
    try {
      return await this.probeAndPersist({
        id: input.id,
        providerId: provider.id,
        modelId: model.id,
        secret: input.secret,
        credentialReference,
        credentialFingerprint: fingerprint(input.secret),
        now: input.now,
        capabilities: input.capabilities,
        roles: input.roles ?? ["planner", "implementer", "reviewer"],
        privacyClass: input.privacyClass ?? "training_eligible"
      });
    } catch (error) {
      await this.vault.delete(credentialReference);
      if (error instanceof ProviderConnectionLifecycleError) throw error;
      throw new ProviderConnectionLifecycleError(
        "probe-failed",
        "The provider checks did not complete. The key was not retained; retry the connection."
      );
    }
  }

  public async reProbe(input: {
    readonly id: string;
    readonly now: number;
    readonly capabilities: readonly ProviderCapability[];
  }): Promise<ProviderConnectionResult> {
    const current = await this.requireConnection(input.id);
    const secret = await this.vault.read(current.credentialReference);
    if (!secret) {
      const stale = providerConnectionSchema.parse({
        ...current,
        credentialState: "revoked",
        state: "stale",
        updatedAt: input.now
      });
      await this.repository.write(stale);
      return {
        connection: stale,
        admission: {
          admitted: false,
          reason: "credential-revoked",
          detail: "The local credential is missing. Connect a replacement key.",
          retryAt: null
        }
      };
    }
    try {
      return await this.probeAndPersist({
        id: current.id,
        providerId: current.providerId,
        modelId: current.modelId,
        secret,
        credentialReference: current.credentialReference,
        credentialFingerprint: current.credentialFingerprint,
        now: input.now,
        capabilities: input.capabilities,
        roles: current.capabilityRoles,
        privacyClass: current.privacyClass
      });
    } catch {
      await this.repository.write(providerConnectionSchema.parse({
        ...current,
        state: "stale",
        updatedAt: input.now
      }));
      throw new ProviderConnectionLifecycleError(
        "probe-failed",
        "The provider checks did not complete. Queued work remains safe; retry after the provider recovers."
      );
    }
  }

  public async replaceModel(input: {
    readonly id: string;
    readonly modelId: string;
    readonly now: number;
    readonly capabilities: readonly ProviderCapability[];
  }): Promise<ProviderConnectionResult> {
    const current = await this.requireConnection(input.id);
    const secret = await this.vault.read(current.credentialReference);
    if (!secret) {
      throw new ProviderConnectionLifecycleError(
        "credential-missing",
        "Reconnect the provider key before selecting a replacement model."
      );
    }
    const provider = catalogProvider(current.providerId);
    if (!provider.models.some((model) => model.id === input.modelId)) {
      throw new ProviderConnectionLifecycleError(
        "model-unavailable",
        "Choose a replacement model from the verified provider catalogue."
      );
    }
    return this.probeAndPersist({
      id: current.id,
      providerId: current.providerId,
      modelId: input.modelId,
      secret,
      credentialReference: current.credentialReference,
      credentialFingerprint: current.credentialFingerprint,
      now: input.now,
      capabilities: input.capabilities,
      roles: current.capabilityRoles,
      privacyClass: current.privacyClass
    });
  }

  public async revoke(id: string, now: number): Promise<ProviderConnection> {
    const current = await this.requireConnection(id);
    await this.vault.delete(current.credentialReference);
    const revoked = providerConnectionSchema.parse({
      ...current,
      credentialState: "revoked",
      state: "revoked",
      updatedAt: now
    });
    await this.repository.write(revoked);
    return revoked;
  }

  public async disconnect(id: string): Promise<void> {
    const current = await this.requireConnection(id);
    await this.vault.delete(current.credentialReference);
    await this.repository.delete(id);
  }

  private async probeAndPersist(input: {
    readonly id: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly secret: string;
    readonly credentialReference: string;
    readonly credentialFingerprint: string;
    readonly now: number;
    readonly capabilities: readonly ProviderCapability[];
    readonly roles: readonly ("planner" | "implementer" | "reviewer")[];
    readonly privacyClass: PrivacyLevel;
  }): Promise<ProviderConnectionResult> {
    const provider = catalogProvider(input.providerId);
    const model = provider.models.find((candidate) => candidate.id === input.modelId);
    if (!model) throw new Error("Verified provider model disappeared during probing.");
    const [cost, quota, canary] = await Promise.all([
      this.probes.cost(input),
      this.probes.quota(input),
      this.probes.canary(input)
    ]);
    const probed = providerConnectionSchema.parse({
      schemaVersion: 1,
      id: input.id,
      providerId: provider.id,
      modelId: model.id,
      apiBaseUrl: provider.apiBaseUrl,
      credentialReference: input.credentialReference,
      credentialFingerprint: input.credentialFingerprint,
      credentialState: "active",
      state: "ready",
      privacyClass: input.privacyClass,
      capabilityRoles: input.roles,
      contextWindowTokens: model.contextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
      cost,
      quota,
      canary,
      updatedAt: input.now
    });
    const admission = evaluateProviderAdmission({
      connection: probed,
      now: input.now,
      requiredCapabilities: input.capabilities
    });
    const connection = admission.admitted
      ? probed
      : providerConnectionSchema.parse({
          ...probed,
          state: admission.reason.includes("stale") ? "stale" : "limited"
        });
    await this.repository.write(connection);
    return { connection, admission };
  }

  private async requireConnection(id: string): Promise<ProviderConnection> {
    validateConnectionId(id);
    const connection = await this.repository.read(id);
    if (!connection) {
      throw new ProviderConnectionLifecycleError(
        "connection-missing",
        "The provider connection does not exist."
      );
    }
    return providerConnectionSchema.parse(connection);
  }
}

export function resolveAdmittedProviderCandidates(input: {
  readonly connections: readonly ProviderConnection[];
  readonly now: number;
  readonly requiredCapabilities: readonly ProviderCapability[];
  readonly priorityByConnectionId: Readonly<Record<string, number>>;
  readonly usageByConnectionId: Readonly<Record<string, ProviderCapacityUsage>>;
  readonly circuitOpenUntilByConnectionId?: Readonly<Record<string, number>> | undefined;
}): ProviderCandidateResolution {
  const candidates: ProviderCandidate[] = [];
  const excluded: {
    connectionId: string;
    decision: ProviderAdmissionDecision;
  }[] = [];
  for (const connection of input.connections) {
    const decision = evaluateProviderAdmission({
      connection,
      now: input.now,
      requiredCapabilities: input.requiredCapabilities
    });
    if (!decision.admitted) {
      excluded.push({ connectionId: connection.id, decision });
      continue;
    }
    const usage = input.usageByConnectionId[connection.id];
    if (!usage) {
      excluded.push({
        connectionId: connection.id,
        decision: {
          admitted: false,
          reason: "connection-not-ready",
          detail: "Runtime consumption evidence is unavailable. Rebuild usage state before dispatch.",
          retryAt: null
        }
      });
      continue;
    }
    candidates.push(createAdmittedProviderCandidate({
      connection,
      now: input.now,
      priority: input.priorityByConnectionId[connection.id] ?? 100,
      usage,
      circuitOpenUntil: input.circuitOpenUntilByConnectionId?.[connection.id] ?? 0,
      requiredCapabilities: input.requiredCapabilities
    }));
  }
  return { candidates, excluded };
}

export class ProviderConnectionLifecycleError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProviderConnectionLifecycleError";
  }
}

function validateConnectionId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id)) {
    throw new ProviderConnectionLifecycleError(
      "invalid-connection-id",
      "Use a short connection name containing letters, numbers, dots, dashes, or underscores."
    );
  }
}

function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}
