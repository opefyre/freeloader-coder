import { z } from "zod";

export const integrationResourceSchema = z.strictObject({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["github_repository", "jira_project"]),
  label: z.string().trim().min(1).max(200),
  url: z.string().url().max(2_048),
  detail: z.string().trim().min(1).max(300),
});

const githubConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal("github"),
  state: z.enum(["ready", "not_connected", "unavailable", "failed"]),
  accountLabel: z.string().trim().min(1).max(200).nullable(),
  authMethod: z.literal("github_cli_oauth"),
  observedAt: z.number().int().nonnegative(),
  resources: z.array(integrationResourceSchema).max(100),
  nextAction: z.string().trim().min(1).max(300),
});

const jiraConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal("jira"),
  state: z.enum(["ready", "not_connected", "unavailable", "failed"]),
  accountLabel: z.string().trim().min(1).max(200).nullable(),
  authMethod: z.literal("jira_api_token"),
  observedAt: z.number().int().nonnegative(),
  resources: z.array(integrationResourceSchema).max(100),
  nextAction: z.string().trim().min(1).max(300),
});

export const publicIntegrationConnectionSchema = z.discriminatedUnion("provider", [
  githubConnectionSchema,
  jiraConnectionSchema,
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

export const publicIntegrationConnectionCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_observation"),
  observedAt: z.number().int().nonnegative(),
  connections: z.array(publicIntegrationConnectionSchema).max(20),
});

export type PublicIntegrationConnectionCollection = z.infer<
  typeof publicIntegrationConnectionCollectionSchema
>;
