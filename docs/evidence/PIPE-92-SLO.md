# PIPE-92 — Outcome-based health and error budgets

## Delivered

- Health is derived from useful progress, queue age, outcome failures, service evidence, and active work—not process existence alone.
- Error budget calculation reports availability target, consumed budget, and remaining percentage.
- Slow active work remains distinguishable from a stalled system.

## Proof

- Domain: `packages/reliability/src/health.ts`
- Tests: `tests/reliability-engine.test.ts`
- UI: Settings → Outcome health
