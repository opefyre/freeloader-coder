# PIPE-43 — Operating-system credential storage

Status: verified locally on 2026-07-28.

## Outcome

Pipeline Studio now has typed macOS Keychain, Windows Credential Manager, and
Linux Secret Service adapters; an explicit authenticated-encryption fallback;
SQLite metadata-only persistence; provider-scoped access; and deterministic
create, rotate, revoke, delete, export-exclusion, and lifecycle integration.

## Acceptance evidence

- Secret values are sent through sensitive standard input, never child-process
  arguments, and native read output is explicitly marked sensitive.
- SQLite contains opaque references and fingerprints only. The encrypted
  fallback was inspected to confirm plaintext exclusion.
- Access requires `pipeline-studio-local-core`, the owning provider, and a
  declared purpose.
- Revocation removes native access; deletion removes metadata; export excludes
  fingerprints and all credential material.
- `ProviderCredentialVaultBridge` plugs this boundary into the existing provider
  lifecycle without changing its reference-only contract.

## Verification

- `tests/credential-vault.test.ts`
- `tests/provider-connection-lifecycle.test.ts`
- Architecture: `docs/security/credential-storage.md`
- Full release-gate result recorded in the Sprint 6 completion comment.

