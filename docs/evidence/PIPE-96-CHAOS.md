# PIPE-96 — Chaos testing and release gates

## Delivered

- Deterministic injection for rate limit, timeout, crash, disk pressure, network loss, database lock, worker loss, lease expiry, duplicate delivery, and OAuth expiry.
- Release is blocked by integrity loss, duplicate external effects, failed rollback, or an unbounded terminal state.
- The restore drill presents per-fault evidence and one truthful release verdict.

## Proof

- Domain: `packages/reliability/src/chaos.ts`
- Tests: `tests/reliability-engine.test.ts`
- UI: Settings → Reliability release gate
