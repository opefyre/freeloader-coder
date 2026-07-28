# Credential storage and removal contract

Pipeline Studio stores provider credentials through the authenticated local
core. Browser code receives provider instructions, connection state, and a
masked fingerprint only.

## Supported stores

- macOS: Keychain generic-password records.
- Windows: Credential Manager password-vault records.
- Linux: Secret Service records through `secret-tool`.
- Fallback: an explicitly selected AES-256-GCM encrypted file protected by a
  user-supplied passphrase. The fallback is never silently selected.

Credential material is delivered to native helpers through standard input, not
command arguments. Reads are marked sensitive so command output cannot enter
logs or diagnostics.

## Local metadata

SQLite stores only the opaque vault reference, provider identifier, 12-character
fingerprint, backend kind, lifecycle state, and timestamps. Export removes the
fingerprint. Backups, diagnostics, analytics, tickets, and browser projections
must not contain credential values.

## Lifecycle

- Create refuses duplicate references.
- Access requires the authenticated local-core identity, owning provider, and
  declared purpose.
- Rotation replaces the value in place and updates the fingerprint.
- Revocation deletes native access and retains a revoked metadata record.
- Deletion removes both the native value and local metadata.
- Uninstall asks whether provider-side credentials should also be revoked and
  links to the exact provider instructions. It never claims a provider-side
  token was revoked until that external action is verified.

