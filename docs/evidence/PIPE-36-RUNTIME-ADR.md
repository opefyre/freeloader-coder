# PIPE-36 — Supported clone runtime and update strategy

Status: verified locally on 2026-07-28.

## Outcome

Pipeline Studio now has an explicit clone-to-running architecture contract for
supported computers, runtime ownership, private state, loopback-only access,
execution isolation, repairs, updates, and rollback.

## Acceptance evidence

- `docs/architecture/ADR-002-clone-runtime-lifecycle.md` records the support
  matrix, observed prototype evidence, rejected alternatives, and measurable
  replacement triggers.
- One controller lease owns a profile; interrupted effects are reconciled from
  durable checkpoints before any replay.
- Product configuration is validated without accepting secret-shaped values.
  Credentials remain outside repository and diagnostic state.
- Updates preserve the prior version and require health verification before the
  new version becomes canonical.

## Verification

- `tests/runtime-adr-contract.test.ts`
- `tests/runtime-lifecycle.test.ts`
- Full release gate: 213 tests passed, 0 failed; setup, format, lint, typecheck,
  build, Studio build, and diff check passed.

