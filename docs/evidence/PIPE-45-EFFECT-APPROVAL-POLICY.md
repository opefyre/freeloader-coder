# PIPE-45 — Effect-based capability and approval policy

## Outcome

Pipeline Studio now evaluates authority from the concrete effect being attempted, not from the tool or model requesting it. The trusted policy module classifies read-only, local reversible, local consequential, external reversible, external consequential, credential, permission-expanding, destructive, and paid effects.

## Acceptance evidence

- Strict effect, capability grant, approval, and project policy schemas reject unknown fields and malformed cost, expiry, revocation, and override data.
- Guided, Balanced, and Autonomous presets support per-project overrides while immutable safeguards keep credentials, permission expansion, destructive actions, and paid use out of automatic execution.
- Models and plugins cannot self-grant authority: the grant issuer schema accepts only the user or trusted system policy.
- An approval is bound to the full effect digest. A changed plan, target, permission set, cost, or reversibility invalidates the approval and requires a new decision.
- Authorization detects bypass attempts, stale or revoked approvals, duplicate idempotency keys, replayed approvals, expired or revoked capabilities, and cross-project or cross-target reuse.
- Every approval exposes five consistent facts: target, effect, cost, required evidence, and undo or compensation.
- Revocation blocks new work immediately and returns a safe reconciliation action for active work.

## Verification

- `tests/effect-policy.test.ts`: deterministic policy, approval, replay, grant, and revocation coverage.
- `tests/content-patterns.test.ts`: five-fact approval content contract.
- Full repository verification: 141 tests passed, 0 failed.
- Type checks passed.
- Core and Studio production builds passed.
- `git diff --check` passed.

## Architecture note

The SHA-256 effect digest remains in the trusted local policy package and is exposed through the `@freeloader/policy/effect-policy` service subpath. Browser code consumes privacy-safe projections and does not import the trusted digest implementation.

