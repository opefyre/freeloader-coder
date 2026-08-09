import { z } from "zod";

export const integrationResourceSchema = z.strictObject({
  id: z.string().trim().min(1).max(500),
  kind: z.literal("github_repository"),
  label: z.string().trim().min(1).max(200),
  url: z.string().url().max(2_048),
  detail: z.string().trim().min(1).max(300),
});

export const publicIntegrationConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal("github"),
  state: z.enum(["ready", "not_connected", "unavailable", "failed"]),
  accountLabel: z.string().trim().min(1).max(200).nullable(),
  authMethod: z.literal("github_cli_oauth"),
  observedAt: z.number().int().nonnegative(),
  resources: z.array(integrationResourceSchema).max(100),
  nextAction: z.string().trim().min(1).max(300),
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
