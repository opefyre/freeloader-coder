# PIPE-90 — Backup, restore, export, and transfer

## Delivered

- Preflight preview listing included and excluded data, size, destination, encryption, and credential exclusion.
- Restore planning for empty, existing, older, and newer profiles.
- Explicit conflict strategies; no silent overwrite is possible.

## Proof

- Domain: `packages/data-lifecycle/src/portability.ts`
- Tests: `tests/data-lifecycle.test.ts`
- UI: Settings → Preview backup / Verify restore
