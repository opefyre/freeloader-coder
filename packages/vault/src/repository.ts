import { DatabaseSync } from "node:sqlite";

import {
  credentialMetadataSchema,
  type CredentialMetadata,
  type CredentialMetadataRepository
} from "./contracts.js";

export class SqliteCredentialMetadataRepository
implements CredentialMetadataRepository {
  private readonly database: DatabaseSync;

  public constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS credential_metadata (
        reference TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        backend TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
    `);
  }

  public read(reference: string): CredentialMetadata | null {
    const row = this.database.prepare(`
      SELECT reference, provider_id, fingerprint, backend, state, created_at, updated_at
      FROM credential_metadata WHERE reference = ?
    `).get(reference);
    return row ? parseRow(row) : null;
  }

  public list(): readonly CredentialMetadata[] {
    return this.database.prepare(`
      SELECT reference, provider_id, fingerprint, backend, state, created_at, updated_at
      FROM credential_metadata ORDER BY reference
    `).all().map(parseRow);
  }

  public write(metadata: CredentialMetadata): void {
    const value = credentialMetadataSchema.parse(metadata);
    this.database.prepare(`
      INSERT INTO credential_metadata (
        reference, provider_id, fingerprint, backend, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(reference) DO UPDATE SET
        provider_id=excluded.provider_id,
        fingerprint=excluded.fingerprint,
        backend=excluded.backend,
        state=excluded.state,
        updated_at=excluded.updated_at
    `).run(
      value.reference,
      value.providerId,
      value.fingerprint,
      value.backend,
      value.state,
      value.createdAt,
      value.updatedAt
    );
  }

  public delete(reference: string): void {
    this.database.prepare(
      "DELETE FROM credential_metadata WHERE reference = ?"
    ).run(reference);
  }
}

function parseRow(row: unknown): CredentialMetadata {
  const value = row as Record<string, unknown>;
  return credentialMetadataSchema.parse({
    schemaVersion: 1,
    reference: value.reference,
    providerId: value.provider_id,
    fingerprint: value.fingerprint,
    backend: value.backend,
    state: value.state,
    createdAt: value.created_at,
    updatedAt: value.updated_at
  });
}

