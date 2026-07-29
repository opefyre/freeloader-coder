import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/);
const connectionIdentifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);
const timestamp = z.number().int().nonnegative();
const capabilitySchema = z.enum(["chat", "structured_output", "tool_calling", "long_context"]);

export const publicProviderConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: connectionIdentifier,
  providerId: identifier,
  providerLabel: z.string().trim().min(1).max(120),
  modelId: identifier,
  state: z.enum(["ready", "limited", "stale", "revoked"]),
  credentialState: z.enum(["active", "revoked"]),
  maskedCredential: z.string().max(40),
  privacyClass: z.enum(["training_eligible", "no_training", "zero_retention", "local"]),
  capabilityRoles: z.array(z.enum(["planner", "implementer", "reviewer"])).min(1),
  cost: z.strictObject({
    access: z.enum(["permanent_free", "account_limited_free", "promotional_credit", "paid", "unknown"]),
    plan: z.string().trim().min(1).max(120),
    zeroCost: z.boolean(),
    billingEnabled: z.boolean(),
    observedAt: timestamp,
    expiresAt: z.number().int().positive(),
    source: z.enum(["official_documentation", "account_api", "user_attestation"])
  }),
  quota: z.strictObject({
    source: z.enum(["official_documentation", "account_api", "response_headers", "conservative_default"]),
    observedAt: timestamp,
    expiresAt: z.number().int().positive(),
    requestsPerMinute: z.number().int().positive().nullable(),
    requestsPerDay: z.number().int().positive().nullable(),
    tokensPerMinute: z.number().int().positive().nullable(),
    tokensPerDay: z.number().int().positive().nullable(),
    remainingRequests: z.number().int().nonnegative().nullable(),
    remainingTokens: z.number().int().nonnegative().nullable(),
    resetAt: timestamp.nullable()
  }),
  canary: z.strictObject({
    status: z.enum(["passed", "failed"]),
    observedAt: timestamp,
    expiresAt: z.number().int().positive(),
    modelId: identifier,
    capabilities: z.array(capabilitySchema).min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    failureCode: identifier.nullable()
  }),
  admission: z.strictObject({
    admitted: z.boolean(),
    reason: identifier,
    detail: z.string().trim().min(1).max(500),
    retryAt: timestamp.nullable()
  }),
  updatedAt: timestamp
});

export const publicProviderCatalogEntrySchema = z.strictObject({
  id: connectionIdentifier,
  label: z.string().trim().min(1).max(120),
  dashboardUrl: z.url(),
  summary: z.string().trim().min(1).max(500),
  freeAccess: z.enum(["permanent", "account_limited"]),
  models: z.array(z.strictObject({
    id: identifier,
    label: z.string().trim().min(1).max(120),
    contextWindowTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    preview: z.boolean()
  })).min(1),
  sourceUrls: z.array(z.url()).min(1)
});

export const publicProviderConnectionCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: timestamp,
  automaticSpendLimitUsd: z.literal(0),
  catalog: z.array(publicProviderCatalogEntrySchema),
  connections: z.array(publicProviderConnectionSchema)
});

export const providerConnectRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: connectionIdentifier,
  providerId: identifier,
  modelId: identifier,
  secret: z.string().min(8).max(16_384),
  freeOnlyAttestation: z.literal(true),
  billingEnabled: z.literal(false),
  privacyClass: z.enum(["training_eligible", "no_training", "zero_retention"]).default("training_eligible"),
  capabilityRoles: z.array(z.enum(["planner", "implementer", "reviewer"])).min(1).max(3)
});

export const providerModelChangeRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelId: identifier
});

export const providerConnectionMutationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["connected", "reprobed", "model_changed", "revoked", "deleted"]),
  connection: publicProviderConnectionSchema.nullable()
});

export type PublicProviderConnection = z.infer<typeof publicProviderConnectionSchema>;
export type PublicProviderConnectionCollection = z.infer<typeof publicProviderConnectionCollectionSchema>;
export type ProviderConnectRequest = z.infer<typeof providerConnectRequestSchema>;
export type ProviderConnectionMutationResponse = z.infer<typeof providerConnectionMutationResponseSchema>;
