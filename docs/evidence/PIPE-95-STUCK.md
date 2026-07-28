# PIPE-95 — Stuck-task detection and recovery

## Delivered

- Stage-aware stall thresholds distinguish slow healthy work from genuine loss of progress.
- Recovery order inspects evidence, preserves checkpoints, releases only expired leases, and retries only within a bounded budget.
- Unsafe or exhausted recovery reaches a clear `needs_user` or `quarantined` state with the smallest decision required.

## Proof

- Domain: `packages/reliability/src/stuck.ts`
- Tests: `tests/reliability-engine.test.ts`
- UI: Settings → Outcome health and Interruption recovery
