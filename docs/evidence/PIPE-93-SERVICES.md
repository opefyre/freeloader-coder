# PIPE-93 — Supervised services and narrow recovery

## Delivered

- Exact process-count, heartbeat, lease, migration, model-request, and external-effect checks.
- Recovery decisions restart only a proven stopped service.
- Duplicate processes, uncertain external effects, active migrations, and active model calls require bounded escalation.

## Proof

- Domain: `packages/reliability/src/supervisor.ts`
- Tests: `tests/reliability-engine.test.ts`
- UI: Settings → Outcome health service cards
