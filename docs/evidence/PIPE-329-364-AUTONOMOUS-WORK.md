# PIPE-329–364 — Autonomous work milestone

## Delivered claim

Pipeline Studio now has a live, local, free-only safe-step coordinator and Work
Center. It derives recommendations from canonical durable requests, can perform
only typed actions already covered by existing authority, persists private
preferences and receipts, schedules waits, and stops at every consequential
human boundary.

## Owned implementation

| Area | Source |
| --- | --- |
| Public contracts | `packages/runtime/src/autonomy.ts` |
| Deterministic planner | `packages/orchestration/src/safe-next-action.ts` |
| Persistence, leases, modes, receipts, background loop | `apps/core/src/local-autonomy-service.ts` |
| Loopback routes and error mapping | `apps/core/src/control-plane.ts` |
| Runtime composition and shutdown | `apps/core/src/control-plane-main.ts` |
| Typed browser client | `apps/studio/src/autonomy-client.ts` |
| Live Work Center | `apps/studio/src/components/orchestration/autonomous-work-center.tsx` |
| Planner, persistence, restart, policy proof | `tests/autonomy-coordinator.test.ts` |
| API and client security proof | `tests/autonomy-api-client.test.ts` |
| Work Center interaction proof | `tests/studio-autonomous-work-center.test.ts` |

## Negative proof

- Unconfirmed broader automation is denied.
- Request modes cannot exceed project policy.
- Stale request revisions cannot advance.
- Duplicate coordinator work is blocked by a lease.
- Approval boundaries never produce executable actions.
- Paused projects do not advance.
- Remote origins, missing idempotency, oversized bodies, malformed schemas, and
  invalid identities fail closed.
- Automatic cost is structurally `$0`.
- Offline and stale UI states never substitute sample work.

## Browser acceptance

Verify `/work` in light and dark themes, filter every queue class, select a
recommendation, preview a safe step, cancel without mutation, inspect project
mode confirmation, and confirm the durable request panel remains available
under the live coordinator.

## Known limits

- Balanced mode is intentionally recommendation-first in this beta.
- The coordinator does not create Jira issues, push Git, publish, deploy, or
  enable paid providers.
- Provider proposal retries remain owned by the existing proposal generator;
  the coordinator displays its canonical schedule rather than creating a
  second retry engine.
