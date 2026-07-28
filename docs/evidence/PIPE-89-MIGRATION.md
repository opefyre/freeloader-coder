# PIPE-89 — Atomic crash-safe migration

## Delivered

- Backup → migrate → verify → commit state machine with an idempotency key.
- Automatic rollback to the previous snapshot when mutation or verification fails.
- Read-only recovery for data produced by a newer incompatible schema.

## Proof

- Domain: `packages/data-lifecycle/src/migrations.ts`
- Tests: `tests/data-lifecycle.test.ts`
- UI: Settings → Atomic migration
