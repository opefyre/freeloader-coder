# PIPE-58 — Durable scheduler evidence

- Domain: `packages/orchestration/src/durable-scheduler.ts`
- Coordination primitives: `packages/storage/src/coordination.ts`
- Interactive proof: `/work`, “Durable scheduler evidence”
- Automated proof: `tests/orchestration-durable-scheduler.test.ts`

The scheduler enforces one live lease owner, revision-safe transitions, dependency eligibility, deterministic fairness, configurable activity health, and exactly-once external effects across replay.
