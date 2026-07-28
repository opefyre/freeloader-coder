# PIPE-94 — Sleep, restart, offline, and quota recovery

## Delivered

- Distinct reconciliation plans for sleep, shutdown, restart, offline providers, quota, credentials, workers, and environment failures.
- Work is checkpointed, leases are safely released, and quota wakeups are scheduled without busy polling.
- Partial writes restore the last valid checkpoint and never repeat a journaled external effect.

## Proof

- Domain: `packages/reliability/src/reconciliation.ts`
- Tests: `tests/reliability-engine.test.ts`
- UI: Settings → Interruption recovery
