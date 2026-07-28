import { createHash } from "node:crypto";

import {
  credentialAccessSchema,
  credentialMetadataSchema,
  type CredentialAccess,
  type CredentialMetadata,
  type CredentialMetadataRepository,
  type NativeCredentialBackend
} from "./contracts.js";

export class OperatingSystemCredentialVault {
  public constructor(
    private readonly backend: NativeCredentialBackend,
    private readonly metadata: CredentialMetadataRepository
  ) {
    if (!backend.available) {
      throw new CredentialVaultError(
        "backend-unavailable",
        "The operating-system credential store is unavailable. Unlock it or choose the encrypted fallback."
      );
    }
  }

  public async create(input: {
    readonly reference: string;
    readonly providerId: string;
    readonly value: string;
    readonly now: number;
  }): Promise<CredentialMetadata> {
    if (this.metadata.read(input.reference)) {
      throw new CredentialVaultError(
        "duplicate-reference",
        "This credential reference already exists. Rotate it instead."
      );
    }
    assertReferenceProvider(input.reference, input.providerId);
    assertCredentialValue(input.value);
    await this.backend.write(input.reference, input.value);
    const record = credentialMetadataSchema.parse({
      schemaVersion: 1,
      reference: input.reference,
      providerId: input.providerId,
      fingerprint: fingerprint(input.value),
      backend: this.backend.kind,
      state: "active",
      createdAt: input.now,
      updatedAt: input.now
    });
    this.metadata.write(record);
    return record;
  }

  public async access(
    reference: string,
    access: CredentialAccess
  ): Promise<string> {
    const request = credentialAccessSchema.parse(access);
    const record = this.requireActive(reference);
    if (record.providerId !== request.providerId) {
      throw new CredentialVaultError(
        "provider-scope-denied",
        "This credential belongs to a different provider."
      );
    }
    const value = await this.backend.read(reference);
    if (!value) {
      throw new CredentialVaultError(
        "credential-missing",
        "The operating-system credential was removed. Connect a replacement."
      );
    }
    return value;
  }

  public async rotate(input: {
    readonly reference: string;
    readonly providerId: string;
    readonly value: string;
    readonly now: number;
    readonly access: CredentialAccess;
  }): Promise<CredentialMetadata> {
    credentialAccessSchema.parse(input.access);
    const current = this.requireActive(input.reference);
    if (
      current.providerId !== input.providerId ||
      input.access.providerId !== input.providerId ||
      input.access.purpose !== "rotate"
    ) {
      throw new CredentialVaultError(
        "provider-scope-denied",
        "Rotation is limited to the owning provider and local service."
      );
    }
    assertCredentialValue(input.value);
    await this.backend.write(input.reference, input.value);
    const rotated = credentialMetadataSchema.parse({
      ...current,
      fingerprint: fingerprint(input.value),
      updatedAt: input.now
    });
    this.metadata.write(rotated);
    return rotated;
  }

  public async revoke(
    reference: string,
    access: CredentialAccess,
    now: number
  ): Promise<CredentialMetadata> {
    const request = credentialAccessSchema.parse(access);
    const current = this.requireActive(reference);
    if (request.providerId !== current.providerId || request.purpose !== "revoke") {
      throw new CredentialVaultError(
        "provider-scope-denied",
        "Revocation is limited to the owning provider and local service."
      );
    }
    await this.backend.delete(reference);
    const revoked = credentialMetadataSchema.parse({
      ...current,
      state: "revoked",
      updatedAt: now
    });
    this.metadata.write(revoked);
    return revoked;
  }

  public async delete(
    reference: string,
    access: CredentialAccess
  ): Promise<void> {
    const request = credentialAccessSchema.parse(access);
    const current = this.metadata.read(reference);
    if (!current) return;
    if (request.providerId !== current.providerId || request.purpose !== "delete") {
      throw new CredentialVaultError(
        "provider-scope-denied",
        "Deletion is limited to the owning provider and local service."
      );
    }
    await this.backend.delete(reference);
    this.metadata.delete(reference);
  }

  public exportMetadata(): readonly Omit<CredentialMetadata, "fingerprint">[] {
    return this.metadata.list().map(({ fingerprint: _excluded, ...record }) => record);
  }

  private requireActive(reference: string): CredentialMetadata {
    const record = this.metadata.read(reference);
    if (!record || record.state !== "active") {
      throw new CredentialVaultError(
        "credential-missing",
        "The credential is unavailable or revoked."
      );
    }
    return record;
  }
}

export class CredentialVaultError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CredentialVaultError";
  }
}

export class ProviderCredentialVaultBridge {
  public constructor(
    private readonly vault: OperatingSystemCredentialVault,
    private readonly now: () => number
  ) {}

  public async write(reference: string, value: string): Promise<void> {
    const providerId = providerFromReference(reference);
    try {
      await this.vault.create({
        reference,
        providerId,
        value,
        now: this.now()
      });
    } catch (error) {
      if (!(error instanceof CredentialVaultError) || error.code !== "duplicate-reference") {
        throw error;
      }
      await this.vault.rotate({
        reference,
        providerId,
        value,
        now: this.now(),
        access: {
          serviceIdentity: "pipeline-studio-local-core",
          providerId,
          purpose: "rotate"
        }
      });
    }
  }

  public async read(reference: string): Promise<string | null> {
    const providerId = providerFromReference(reference);
    try {
      return await this.vault.access(reference, {
        serviceIdentity: "pipeline-studio-local-core",
        providerId,
        purpose: "invoke"
      });
    } catch (error) {
      if (
        error instanceof CredentialVaultError &&
        error.code === "credential-missing"
      ) {
        return null;
      }
      throw error;
    }
  }

  public async delete(reference: string): Promise<void> {
    const providerId = providerFromReference(reference);
    await this.vault.delete(reference, {
      serviceIdentity: "pipeline-studio-local-core",
      providerId,
      purpose: "delete"
    });
  }
}

function assertReferenceProvider(reference: string, providerId: string): void {
  if (!reference.startsWith(`vault:providers/${providerId}/`)) {
    throw new CredentialVaultError(
      "provider-scope-denied",
      "Credential references must be scoped to their provider."
    );
  }
}

function providerFromReference(reference: string): string {
  const match = /^vault:providers\/([a-z0-9][a-z0-9._-]{0,79})\/[a-zA-Z0-9._-]+$/.exec(
    reference
  );
  if (!match?.[1]) {
    throw new CredentialVaultError(
      "invalid-reference",
      "Provider credential references must use the canonical vault path."
    );
  }
  return match[1];
}

function assertCredentialValue(value: string): void {
  if (value.trim().length < 8 || value.length > 16_384) {
    throw new CredentialVaultError(
      "invalid-credential",
      "The credential value is incomplete or exceeds the secure-entry limit."
    );
  }
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
