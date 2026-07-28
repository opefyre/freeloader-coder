# PIPE-91 — Safe cleanup and deletion

## Delivered

- Dry-run planning for selected project deletion and bounded cache cleanup.
- Shared, active, retained, checkpointed, and audited data is preserved.
- External grants are listed as separate revocation work and credentials remain outside export/delete payloads.

## Proof

- Domain: `packages/data-lifecycle/src/portability.ts`
- Tests: `tests/data-lifecycle.test.ts`
- UI: Settings → Deletion dry run
