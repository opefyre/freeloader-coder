import { z } from "zod";

export const credentialBackendSchema = z.enum([
  "macos_keychain",
  "windows_credential_manager",
  "linux_secret_service",
  "encrypted_file"
]);

export const credentialStateSchema = z.enum(["active", "revoked"]);

export const credentialMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  reference: z.string().regex(/^vault:providers\/[a-z0-9._-]+\/[a-zA-Z0-9._-]+$/),
  providerId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{12}$/),
  backend: credentialBackendSchema,
  state: credentialStateSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
}).strict();

export const credentialAccessSchema = z.object({
  serviceIdentity: z.literal("pipeline-studio-local-core"),
  providerId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  purpose: z.enum(["validate", "invoke", "rotate", "revoke", "delete"])
}).strict();

export type CredentialBackendKind = z.infer<typeof credentialBackendSchema>;
export type CredentialMetadata = z.infer<typeof credentialMetadataSchema>;
export type CredentialAccess = z.infer<typeof credentialAccessSchema>;

export interface NativeCredentialBackend {
  readonly kind: CredentialBackendKind;
  readonly available: boolean;
  write(reference: string, value: string): Promise<void>;
  read(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}

export interface CredentialMetadataRepository {
  read(reference: string): CredentialMetadata | null;
  list(): readonly CredentialMetadata[];
  write(metadata: CredentialMetadata): void;
  delete(reference: string): void;
}

