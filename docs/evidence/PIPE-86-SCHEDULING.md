# PIPE-86 — Distributed scheduling

- AC1: only the controller-owned `LeaseAuthority` can issue one current task lease.
- AC2: expiry alone cannot requeue work; prior effects must reconcile before a new lease.
- AC3: trust, revocation, privacy, locality, runtime, model, memory, load, and resource health filter or rank every route.
- Evidence: `packages/distributed/src/scheduler.ts`, deterministic routing and duplicate-lease tests, and Work routing UI.
