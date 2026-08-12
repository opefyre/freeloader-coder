import { z } from "zod";

export const projectIntakeReferenceSchema = z.string().regex(/^(?:selection_[a-f0-9]{32}|[a-z][a-z0-9_-]{2,31}:[A-Za-z0-9_-]{8,160})$/);
export const projectIntakeModeSchema = z.enum(["new_product", "existing_product"]);
export const projectIntakeStateSchema = z.enum(["draft", "resource_selection", "submitted", "analyzing", "needs_input", "cancelled"]);
export const projectIntakeSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().regex(/^intake_[a-f0-9]{20}$/),
  projectMode: projectIntakeModeSchema, state: projectIntakeStateSchema,
  idea: z.string().max(20_000), workspaceReference: projectIntakeReferenceSchema.nullable(),
  workspaceLabel: z.string().trim().min(1).max(255).nullable().default(null),
  attachmentReferences: z.array(projectIntakeReferenceSchema).max(100), selectedResources: z.array(projectIntakeReferenceSchema).max(100),
  revision: z.number().int().positive(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  submittedAt: z.number().int().nonnegative().nullable(), cancellationReason: z.string().trim().min(3).max(500).nullable(),
});
export const projectIntakeCollectionSchema = z.strictObject({ schemaVersion: z.literal(1), intakes: z.array(projectIntakeSchema).max(1_000) });
export const projectIntakeCreateSchema = z.strictObject({ schemaVersion: z.literal(1), projectMode: projectIntakeModeSchema });
export const projectIntakeDraftSchema = z.strictObject({ schemaVersion: z.literal(1), expectedRevision: z.number().int().positive(), idea: z.string().max(20_000), workspaceReference: projectIntakeReferenceSchema.nullable(), workspaceLabel: z.string().trim().min(1).max(255).nullable().default(null), attachmentReferences: z.array(projectIntakeReferenceSchema).max(100) });
export const projectIntakeResourcesSchema = z.strictObject({ schemaVersion: z.literal(1), expectedRevision: z.number().int().positive(), selectedResources: z.array(projectIntakeReferenceSchema).max(100) });
export const projectIntakeRevisionSchema = z.strictObject({ schemaVersion: z.literal(1), expectedRevision: z.number().int().positive() });
export const projectIntakeCancelSchema = z.strictObject({ schemaVersion: z.literal(1), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(3).max(500) });
export type ProjectIntake = z.infer<typeof projectIntakeSchema>;
