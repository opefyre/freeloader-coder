import { z } from "zod";

const boundedLabel = z.string().trim().min(1).max(160);
const opaqueProjectId = z.string().regex(/^project_[a-f0-9]{16}$/);

export const localProjectFactSchema = z.strictObject({
  label: boundedLabel,
  value: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(120),
});

export const localProjectSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: opaqueProjectId,
  displayName: boundedLabel,
  state: z.enum(["ready", "warning", "failed"]),
  observedAt: z.number().int().nonnegative(),
  validForMs: z.number().int().min(1_000).max(86_400_000),
  facts: z.array(localProjectFactSchema).max(20),
  inferences: z.array(z.string().trim().min(1).max(500)).max(20),
  decisions: z.array(z.string().trim().min(1).max(500)).max(20),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
});

export const localProjectCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.literal("local_observation"),
  observedAt: z.number().int().nonnegative(),
  projects: z.array(localProjectSnapshotSchema).max(100),
});

export const localProjectRegistrationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  path: z.string().trim().min(1).max(2_048),
  displayName: boundedLabel.optional(),
});

export const localProjectCreationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  idea: z.string().trim().min(3).max(20_000),
  displayName: boundedLabel.optional(),
});

export const localProjectMutationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["created", "registered", "rescanned", "forgotten"]),
  project: localProjectSnapshotSchema.nullable(),
});

export type LocalProjectSnapshot = z.infer<typeof localProjectSnapshotSchema>;
export type LocalProjectCollection = z.infer<typeof localProjectCollectionSchema>;
export type LocalProjectRegistration = z.infer<typeof localProjectRegistrationSchema>;
export type LocalProjectCreation = z.infer<typeof localProjectCreationSchema>;
export type LocalProjectMutationResponse = z.infer<
  typeof localProjectMutationResponseSchema
>;

export function validateLocalProjectCollection(input: unknown): LocalProjectCollection {
  const collection = localProjectCollectionSchema.parse(input);
  const ids = collection.projects.map((project) => project.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Local project collection contains duplicate identities.");
  }
  return collection;
}
