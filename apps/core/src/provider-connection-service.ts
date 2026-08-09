import { createHash } from "node:crypto";

import {
  providerCanaryEvidenceSchema,
  providerCostEvidenceSchema,
  providerQuotaEvidenceSchema,
  type ProviderConnection
} from "../../../packages/schemas/src/index.js";
import {
  providerConnectRequestSchema,
  providerModelChangeRequestSchema,
  publicProviderConnectionCollectionSchema,
  publicProviderConnectionSchema,
  providerConnectionMutationResponseSchema,
  type ProviderConnectionMutationResponse,
  type PublicProviderConnection,
  type PublicProviderConnectionCollection
} from "../../../packages/runtime/src/provider-connections.js";
import type { ProviderAdapter } from "../../../packages/providers/src/adapter.js";
import { verifiedProviderCatalog } from "../../../packages/providers/src/catalog.js";
import {
  evaluateProviderAdmission,
  type ProviderCapability
} from "../../../packages/providers/src/connection.js";
import {
  ProviderConnectionLifecycle,
  ProviderConnectionLifecycleError,
  type CredentialVault,
  type ProviderConnectionProbes,
  type ProviderConnectionRepository
} from "../../../packages/providers/src/lifecycle.js";

const REQUIRED_CAPABILITIES = ["chat", "structured_output"] as const satisfies readonly ProviderCapability[];
const COST_TTL_MS = 24 * 60 * 60_000;
const CANARY_TTL_MS = 60 * 60_000;

export interface ProviderAdapterResolver {
  adapter(providerId: string): ProviderAdapter | null;
}

export class LiveProviderConnectionProbes implements ProviderConnectionProbes {
  public constructor(private readonly adapters: ProviderAdapterResolver) {}

  public async cost(input: {
    providerId: string;
    secret: string;
    now: number;
  }) {
    void input.secret;
    const provider = eligibleProvider(input.providerId);
    return providerCostEvidenceSchema.parse({
      access: provider.freeAccess === "permanent" ? "permanent_free" : "account_limited_free",
      plan: provider.freeAccess === "permanent" ? "Verified permanent free catalog route" : "User-confirmed free account",
      zeroCost: true,
      billingEnabled: false,
      observedAt: input.now,
      expiresAt: input.now + COST_TTL_MS,
      source: "user_attestation"
    });
  }

  public async quota(input: {
    providerId: string;
    secret: string;
    now: number;
  }) {
    const adapter = requireAdapter(this.adapters, input.providerId);
    return providerQuotaEvidenceSchema.parse(
      await adapter.discoverQuota({ secret: input.secret }, input.now)
    );
  }

  public async canary(input: {
    providerId: string;
    modelId: string;
    secret: string;
    now: number;
    capabilities: readonly ProviderCapability[];
  }) {
    const adapter = requireAdapter(this.adapters, input.providerId);
    const credential = await adapter.validateCredential({ secret: input.secret });
    if (!credential.valid) {
      throw new ProviderConnectionLifecycleError(
        credential.error?.code ?? "invalid-credential",
        credential.error?.safeMessage ?? "The provider rejected this credential. Create a replacement key and retry."
      );
    }
    const models = await adapter.discoverModels({ secret: input.secret });
    if (!models.some((model) => model.id === input.modelId)) {
      throw new ProviderConnectionLifecycleError(
        "model-unavailable",
        "The selected model is not available to this account. Choose one of the verified models returned by the provider."
      );
    }
    const response = await adapter.chat(
      { secret: input.secret },
      {
        requestId: `connection-canary-${input.providerId}-${input.now}`,
        modelId: input.modelId,
        messages: [
          {
            role: "system",
            content: "Return exactly this JSON object and nothing else: {\"ok\":true}"
          },
          {
            role: "user",
            content: "Return the requested object now."
          }
        ],
        maxOutputTokens: 128,
        temperature: 0,
        responseSchema: {
          type: "object",
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"]
        },
        timeoutMs: 45_000
      }
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || (parsed as { ok?: unknown }).ok !== true) {
      throw new ProviderConnectionLifecycleError(
        "structured-output-failed",
        "The live model responded, but did not satisfy the required structured-output canary."
      );
    }
    return providerCanaryEvidenceSchema.parse({
      status: "passed",
      observedAt: input.now,
      expiresAt: input.now + CANARY_TTL_MS,
      modelId: input.modelId,
      capabilities: REQUIRED_CAPABILITIES.filter((capability) =>
        input.capabilities.includes(capability)
      ),
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      failureCode: null
    });
  }
}

export class ProviderConnectionService {
  private readonly lifecycle: ProviderConnectionLifecycle;

  public constructor(
    private readonly repository: ProviderConnectionRepository,
    vault: CredentialVault,
    adapters: ProviderAdapterResolver
  ) {
    this.lifecycle = new ProviderConnectionLifecycle(
      vault,
      repository,
      new LiveProviderConnectionProbes(adapters)
    );
  }

  public async list(now = Date.now()): Promise<PublicProviderConnectionCollection> {
    const connections = await this.repository.list();
    return publicProviderConnectionCollectionSchema.parse({
      schemaVersion: 1,
      observedAt: now,
      automaticSpendLimitUsd: 0,
      catalog: verifiedProviderCatalog
        .filter((provider) => provider.zeroCostEligible && ["permanent", "account_limited"].includes(provider.freeAccess))
        .map((provider) => ({
          id: provider.id,
          label: provider.label,
          dashboardUrl: provider.dashboardUrl,
          summary: provider.summary,
          freeAccess: provider.freeAccess,
          models: provider.models,
          sourceUrls: provider.sourceUrls
        })),
      connections: connections.map((connection) => publicView(connection, now))
    });
  }

  public async connect(input: unknown, now = Date.now()): Promise<ProviderConnectionMutationResponse> {
    const parsed = providerConnectRequestSchema.parse(input);
    eligibleProvider(parsed.providerId);
    const existing = await this.repository.read(parsed.id);
    const fingerprint = createHash("sha256").update(parsed.secret).digest("hex").slice(0, 12);
    if (existing) {
      if (
        existing.providerId === parsed.providerId &&
        existing.modelId === parsed.modelId &&
        existing.credentialFingerprint === fingerprint
      ) {
        return mutation("connected", publicView(existing, now));
      }
      throw new ProviderConnectionServiceError(
        "connection-conflict",
        "That connection name already exists. Choose another name or delete the old connection first."
      );
    }
    const result = await this.lifecycle.connect({
      id: parsed.id,
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      secret: parsed.secret,
      now,
      capabilities: REQUIRED_CAPABILITIES,
      roles: parsed.capabilityRoles,
      privacyClass: parsed.privacyClass
    });
    return mutation("connected", publicView(result.connection, now));
  }

  public async reProbe(id: string, now = Date.now()): Promise<ProviderConnectionMutationResponse> {
    const result = await this.lifecycle.reProbe({
      id,
      now,
      capabilities: REQUIRED_CAPABILITIES
    });
    return mutation("reprobed", publicView(result.connection, now));
  }

  public async replaceModel(id: string, input: unknown, now = Date.now()): Promise<ProviderConnectionMutationResponse> {
    const parsed = providerModelChangeRequestSchema.parse(input);
    const result = await this.lifecycle.replaceModel({
      id,
      modelId: parsed.modelId,
      now,
      capabilities: REQUIRED_CAPABILITIES
    });
    return mutation("model_changed", publicView(result.connection, now));
  }

  public async revoke(id: string, now = Date.now()): Promise<ProviderConnectionMutationResponse> {
    return mutation("revoked", publicView(await this.lifecycle.revoke(id, now), now));
  }

  public async disconnect(id: string): Promise<ProviderConnectionMutationResponse> {
    await this.lifecycle.disconnect(id);
    return mutation("deleted", null);
  }
}

export class ProviderConnectionServiceError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProviderConnectionServiceError";
  }
}

function publicView(connection: ProviderConnection, now: number): PublicProviderConnection {
  const provider = eligibleProvider(connection.providerId);
  const admission = evaluateProviderAdmission({
    connection,
    now,
    requiredCapabilities: REQUIRED_CAPABILITIES
  });
  return publicProviderConnectionSchema.parse({
    schemaVersion: 1,
    id: connection.id,
    providerId: connection.providerId,
    providerLabel: provider.label,
    modelId: connection.modelId,
    state: connection.state,
    credentialState: connection.credentialState,
    maskedCredential: connection.credentialState === "active" ? "vault:••••" : "revoked",
    privacyClass: connection.privacyClass,
    capabilityRoles: connection.capabilityRoles,
    cost: connection.cost,
    quota: connection.quota,
    canary: connection.canary,
    admission,
    updatedAt: connection.updatedAt
  });
}

function mutation(
  outcome: ProviderConnectionMutationResponse["outcome"],
  connection: PublicProviderConnection | null
): ProviderConnectionMutationResponse {
  return providerConnectionMutationResponseSchema.parse({
    schemaVersion: 1,
    outcome,
    connection
  });
}

function eligibleProvider(providerId: string) {
  const provider = verifiedProviderCatalog.find((candidate) => candidate.id === providerId);
  if (
    !provider ||
    !provider.zeroCostEligible ||
    !["permanent", "account_limited"].includes(provider.freeAccess)
  ) {
    throw new ProviderConnectionLifecycleError(
      "provider-not-free",
      "Choose a verified permanent or account-limited free provider. Paid and promotional-credit routes are disabled."
    );
  }
  return provider;
}

function requireAdapter(adapters: ProviderAdapterResolver, providerId: string): ProviderAdapter {
  const adapter = adapters.adapter(providerId);
  if (!adapter) {
    throw new ProviderConnectionLifecycleError(
      "adapter-unavailable",
      "This provider does not yet have a verified live adapter in this build."
    );
  }
  return adapter;
}
