import { z } from "zod";

export const integrationResourceSchema = z.strictObject({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["github_repository", "jira_project", "telegram_chat", "google_account", "google_calendar", "slack_workspace", "slack_channel", "discord_server", "discord_channel", "cloudflare_account", "gcloud_project", "aws_account", "vercel_team", "cloudflare_r2_bucket", "gcloud_storage_bucket", "aws_s3_bucket"]),
  label: z.string().trim().min(1).max(200),
  url: z.string().url().max(2_048).refine((value) => new URL(value).protocol === "https:", "Resource links must use HTTPS."),
  detail: z.string().trim().min(1).max(300),
});

export const discoveryEvidenceSchema = z.strictObject({
  source: z.enum(["live_probe", "cached_metadata"]),
  freshness: z.enum(["current", "stale"]),
  freshUntil: z.number().int().nonnegative(),
  result: z.enum(["available", "empty", "permission_required", "unavailable"]),
  recovery: z.strictObject({
    action: z.enum(["none", "manage_access", "reconnect", "retry"]),
    label: z.string().trim().min(1).max(100),
  }),
});

const githubConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal("github"),
  state: z.enum(["ready", "not_connected", "authorizing", "setup_required", "unavailable", "failed"]),
  accountLabel: z.string().trim().min(1).max(200).nullable(),
  authMethod: z.literal("github_device_oauth"),
  observedAt: z.number().int().nonnegative(),
  resources: z.array(integrationResourceSchema).max(100),
  nextAction: z.string().trim().min(1).max(300),
  discovery: discoveryEvidenceSchema.optional(),
});

const jiraConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal("jira"),
  state: z.enum(["ready", "not_connected", "authorizing", "setup_required", "unavailable", "failed"]),
  accountLabel: z.string().trim().min(1).max(200).nullable(),
  authMethod: z.literal("jira_oauth_3lo"),
  observedAt: z.number().int().nonnegative(),
  resources: z.array(integrationResourceSchema).max(100),
  nextAction: z.string().trim().min(1).max(300),
  discovery: discoveryEvidenceSchema.optional(),
});

const telegramConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal("telegram"),
  state: z.enum(["ready", "not_connected", "unavailable", "failed"]),
  accountLabel: z.string().trim().min(1).max(200).nullable(),
  authMethod: z.literal("telegram_bot_token"),
  observedAt: z.number().int().nonnegative(),
  resources: z.array(integrationResourceSchema).max(20),
  nextAction: z.string().trim().min(1).max(300),
  discovery: discoveryEvidenceSchema.optional(),
});

function serviceConnectionSchema<const Provider extends string, const AuthMethod extends string>(provider: Provider, authMethod: AuthMethod) {
  return z.strictObject({
    schemaVersion: z.literal(1), provider: z.literal(provider),
    state: z.enum(["ready", "not_connected", "authorizing", "setup_required", "unavailable", "failed"]),
    accountLabel: z.string().trim().min(1).max(200).nullable(), authMethod: z.literal(authMethod),
    observedAt: z.number().int().nonnegative(), resources: z.array(integrationResourceSchema).max(100),
    nextAction: z.string().trim().min(1).max(300),
    discovery: discoveryEvidenceSchema.optional(),
  });
}

const googleConnectionSchema = serviceConnectionSchema("google", "google_oauth");
const slackConnectionSchema = serviceConnectionSchema("slack", "slack_oauth");
const discordConnectionSchema = serviceConnectionSchema("discord", "discord_oauth");
const cloudflareConnectionSchema = serviceConnectionSchema("cloudflare", "cloudflare_api_token");
const awsConnectionSchema = serviceConnectionSchema("aws", "aws_access_key");
const vercelConnectionSchema = serviceConnectionSchema("vercel", "vercel_oauth_or_token");

export const publicIntegrationConnectionSchema = z.discriminatedUnion("provider", [
  githubConnectionSchema,
  jiraConnectionSchema,
  telegramConnectionSchema,
  googleConnectionSchema,
  slackConnectionSchema,
  discordConnectionSchema,
  cloudflareConnectionSchema,
  awsConnectionSchema,
  vercelConnectionSchema,
]);

export const jiraConnectionInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  siteUrl: z.string().url().max(2_048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".atlassian.net") && !url.port;
  }, "Jira site must be an HTTPS atlassian.net site."),
  email: z.string().trim().email().max(320),
  apiToken: z.string().trim().min(8).max(16_384),
});

export const telegramConnectionInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  botToken: z.string().trim().regex(/^\d{6,12}:[a-zA-Z0-9_-]{30,80}$/),
  chatId: z.string().trim().regex(/^(?:-\d{6,20}|\d{6,20}|@[a-zA-Z][a-zA-Z0-9_]{4,31})$/),
  ownerUserId: z.string().trim().regex(/^\d{5,20}$/),
});

export const oauthProviderSchema = z.enum(["github", "jira", "google", "slack", "discord", "vercel"]);

export const tokenConnectionInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.enum(["cloudflare", "aws", "vercel"]),
  accountId: z.string().trim().min(1).max(500).optional(),
  accessKeyId: z.string().trim().min(8).max(500).optional(),
  secret: z.string().trim().min(8).max(16_384),
});

export const oauthAppConfigurationInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: oauthProviderSchema,
  clientId: z.string().trim().min(8).max(500),
  clientSecret: z.string().trim().min(8).max(16_384).optional(),
});

export const oauthAuthorizationStartSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: oauthProviderSchema,
  mode: z.enum(["device", "redirect"]),
  authorizationUrl: z.string().url().max(4_096),
  userCode: z.string().trim().min(1).max(100).nullable(),
  expiresAt: z.number().int().positive(),
});

export type OAuthAuthorizationStart = z.infer<typeof oauthAuthorizationStartSchema>;

export const publicIntegrationConnectionCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_observation"),
  observedAt: z.number().int().nonnegative(),
  connections: z.array(publicIntegrationConnectionSchema).max(20),
});

export type PublicIntegrationConnectionCollection = z.infer<
  typeof publicIntegrationConnectionCollectionSchema
>;

export function withDiscoveryEvidence(
  input: unknown,
  source: "live_probe" | "cached_metadata",
  now = Date.now(),
): PublicIntegrationConnectionCollection {
  const collection = publicIntegrationConnectionCollectionSchema.parse(input);
  return publicIntegrationConnectionCollectionSchema.parse({
    ...collection,
    connections: collection.connections.map((connection) => {
      const freshUntil = connection.observedAt + 5 * 60_000;
      const permissionRequired = /grant\b|permission\b|scope\b|access\s+(?:required|needed|denied|missing|to)\b/i.test(connection.nextAction);
      const result = connection.state === "ready"
        ? connection.resources.length > 0 ? "available" : "empty"
        : permissionRequired ? "permission_required" : "unavailable";
      const recovery = result === "available"
        ? { action: "none" as const, label: "Ready" }
        : result === "permission_required"
          ? { action: "manage_access" as const, label: "Review access" }
          : connection.state === "not_connected" || connection.state === "setup_required"
            ? { action: "reconnect" as const, label: "Connect" }
            : { action: "retry" as const, label: "Try again" };
      return { ...connection, discovery: { source, freshness: now <= freshUntil ? "current" : "stale", freshUntil, result, recovery } };
    }),
  });
}
