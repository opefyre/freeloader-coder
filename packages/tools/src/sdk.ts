import { z } from "zod";

import { toolDefinitionSchema, type ToolDefinition } from "./registry.js";

export const extensionKindSchema = z.enum([
  "provider",
  "connector",
  "tool",
  "workflow",
  "ui"
]);

export const extensionManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9._-]{2,127}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  kind: extensionKindSchema,
  title: z.string().trim().min(1).max(120),
  publisher: z.string().trim().min(1).max(120),
  sourceUrl: z.url(),
  signature: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  coreCompatibility: z.string().regex(/^\^\d+\.\d+\.\d+$/),
  permissions: z.array(z.string().regex(/^[a-z][a-z0-9._-]+$/)).max(50),
  externalServices: z.array(z.hostname()).max(30),
  dataUse: z.string().trim().min(1).max(500),
  costPolicy: z.enum(["free_only", "user_budget_required", "local_only"]),
  support: z.enum(["official", "community", "local", "unsupported"]),
  tools: z.array(toolDefinitionSchema).max(50),
  migrations: z.array(z.strictObject({
    from: z.string().regex(/^\d+\.\d+\.\d+$/),
    to: z.string().regex(/^\d+\.\d+\.\d+$/),
    guidance: z.string().trim().min(1).max(500)
  })).max(20)
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export interface ExtensionCompatibility {
  readonly compatible: boolean;
  readonly requiresRenewedApproval: boolean;
  readonly reasons: readonly string[];
}

export function validateExtension(input: {
  readonly manifest: unknown;
  readonly coreVersion: string;
  readonly previous: ExtensionManifest | null;
}): { readonly manifest: ExtensionManifest; readonly compatibility: ExtensionCompatibility } {
  const manifest = extensionManifestSchema.parse(input.manifest);
  const reasons: string[] = [];
  const coreMajor = Number(input.coreVersion.split(".")[0]);
  const requiredMajor = Number(manifest.coreCompatibility.slice(1).split(".")[0]);
  if (coreMajor !== requiredMajor) reasons.push("Core major version is incompatible.");
  if (manifest.support !== "local" && manifest.signature === null) {
    reasons.push("Published extensions require a signature.");
  }
  const previousPermissions = new Set(input.previous?.permissions ?? []);
  const requiresRenewedApproval = input.previous !== null
    && manifest.permissions.some((permission) => !previousPermissions.has(permission));
  if (
    input.previous
    && major(manifest.version) > major(input.previous.version)
    && !manifest.migrations.some((migration) =>
      migration.from === input.previous?.version && migration.to === manifest.version
    )
  ) {
    reasons.push("Breaking changes require migration guidance.");
  }
  return {
    manifest,
    compatibility: {
      compatible: reasons.length === 0,
      requiresRenewedApproval,
      reasons
    }
  };
}

export function createExtensionHarness(input: {
  readonly manifest: ExtensionManifest;
  readonly fixtures: Readonly<Record<string, unknown>>;
}): {
  readonly installable: boolean;
  readonly removalPlan: readonly string[];
  readonly contractChecks: readonly string[];
  readonly tools: readonly ToolDefinition[];
} {
  if (Object.keys(input.fixtures).length === 0) throw new Error("SDK harness requires deterministic fixtures.");
  return {
    installable: true,
    removalPlan: [
      "Drain active extension work.",
      "Reconcile canonical effects.",
      "Revoke capability grants.",
      "Delete credential references and local configuration."
    ],
    contractChecks: [
      "manifest-schema",
      "compatibility-window",
      "permission-expansion",
      "effect-policy",
      "install-remove-replay"
    ],
    tools: input.manifest.tools
  };
}

function major(version: string): number {
  return Number(version.split(".")[0]);
}
