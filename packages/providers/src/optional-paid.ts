import { z } from "zod";

import {
  authorizePaidCall,
  type PaidBudgetAuthorization,
  type PaidCallProposal,
} from "../../policy/src/paid-budget.js";

const version = z.literal(1);

export const optionalPaidProviderSchema = z.strictObject({
  schemaVersion: version,
  providerId: z.enum(["openai", "anthropic"]),
  connectionId: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  projectId: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  modelId: z.string().min(2).max(120),
  apiSurface: z.enum(["responses", "messages"]),
  endpoint: z.enum([
    "https://api.openai.com/v1/responses",
    "https://api.anthropic.com/v1/messages",
  ]),
  credentialRef: z.string().regex(/^vault:\/\/[a-z0-9._/-]+$/).nullable(),
  billingSource: z.enum(["openai_api", "anthropic_api"]),
  state: z.enum(["unconfigured", "disabled", "ready"]),
  allowedRoles: z.array(
    z.enum(["planning", "implementation", "review", "analysis"])
  ).max(4),
  storeProviderSide: z.literal(false),
});
export type OptionalPaidProvider = z.infer<typeof optionalPaidProviderSchema>;

export const optionalPaidRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  providerId: z.enum(["openai", "anthropic"]),
  apiSurface: z.enum(["responses", "messages"]),
  endpoint: z.string().url(),
  modelId: z.string().min(2).max(120),
  role: z.enum(["planning", "implementation", "review", "analysis"]),
  credentialRef: z.string().regex(/^vault:\/\/[a-z0-9._/-]+$/),
  storeProviderSide: z.literal(false),
  maxOutputTokens: z.number().int().positive().max(100_000),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  authorizationId: z.string().min(3).max(120),
  requestShape: z.record(z.string(), z.unknown()),
});
export type OptionalPaidRequest = z.infer<typeof optionalPaidRequestSchema>;

export type OptionalRequestDecision =
  | { readonly allowed: true; readonly request: OptionalPaidRequest }
  | { readonly allowed: false; readonly reason: string; readonly detail: string };

export function buildOptionalPaidRequest(input: {
  readonly connection: OptionalPaidProvider;
  readonly authorization: PaidBudgetAuthorization | null;
  readonly proposal: PaidCallProposal;
  readonly requestId: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly now: number;
}): OptionalRequestDecision {
  const connection = optionalPaidProviderSchema.parse(input.connection);
  if (connection.state !== "ready" || connection.credentialRef === null) {
    return {
      allowed: false,
      reason: "connection-disabled",
      detail: "The optional provider is not connected and enabled.",
    };
  }
  if (!connection.allowedRoles.includes(input.proposal.role)) {
    return {
      allowed: false,
      reason: "role-disabled",
      detail: "This provider is not enabled for the requested role.",
    };
  }
  const budget = authorizePaidCall(input.authorization, input.proposal, input.now);
  if (!budget.allowed) {
    return { allowed: false, reason: budget.reason, detail: budget.detail };
  }
  const requestShape = connection.providerId === "openai"
    ? {
        model: connection.modelId,
        input: "content supplied only at execution time",
        store: false,
        max_output_tokens: input.maxOutputTokens,
      }
    : {
        model: connection.modelId,
        messages: "content supplied only at execution time",
        max_tokens: input.maxOutputTokens,
      };
  return {
    allowed: true,
    request: optionalPaidRequestSchema.parse({
      schemaVersion: 1,
      requestId: input.requestId,
      providerId: connection.providerId,
      apiSurface: connection.apiSurface,
      endpoint: connection.endpoint,
      modelId: connection.modelId,
      role: input.proposal.role,
      credentialRef: connection.credentialRef,
      storeProviderSide: false,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
      authorizationId: budget.authorizationId,
      requestShape,
    }),
  };
}

export const disconnectedOptionalProviders: readonly OptionalPaidProvider[] = [
  {
    schemaVersion: 1,
    providerId: "openai",
    connectionId: "openai-api",
    projectId: "main-project",
    modelId: "user-selected-openai-model",
    apiSurface: "responses",
    endpoint: "https://api.openai.com/v1/responses",
    credentialRef: null,
    billingSource: "openai_api",
    state: "unconfigured",
    allowedRoles: [],
    storeProviderSide: false,
  },
  {
    schemaVersion: 1,
    providerId: "anthropic",
    connectionId: "anthropic-api",
    projectId: "main-project",
    modelId: "user-selected-anthropic-model",
    apiSurface: "messages",
    endpoint: "https://api.anthropic.com/v1/messages",
    credentialRef: null,
    billingSource: "anthropic_api",
    state: "unconfigured",
    allowedRoles: [],
    storeProviderSide: false,
  },
] as const;
