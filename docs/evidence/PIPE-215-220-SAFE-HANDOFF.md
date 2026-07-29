# PIPE-215–220: immutable zero-effect handoff proof

## Delivered

- Strict versioned approval, execution-contract, lease, event, and run projections.
- Approval binds the opaque request/project IDs, normalized outcome, checks, zero-effect
  policy, empty effect set, and `$0.00` maximum cost into one SHA-256 digest.
- Atomic private lifecycle persistence with idempotent approve/claim/checkpoint/release,
  exactly one bounded lease, monotonic events, restart recovery, guarded cancellation,
  terminal archive, and corruption preservation.
- Loopback-only approval, claim, checkpoint, release, and reconciliation endpoints.
- A real Work approval experience showing effects, maximum cost, undo, contract digest,
  durable event order, and only currently legal actions.
- Explicit visual separation from the synthetic execution workbench.

## Automated evidence

- `npm run verify`: passed, 477/477 tests.
- `npm run studio:release-check`: passed.
- `git diff --check`: passed.
- Studio entry: 398,255 / 450,000 bytes.
- Shared runtime: 189,644 / 210,000 bytes.
- Local request feature: 16,767 / 75,000 bytes.

Coverage includes immutable contract linkage, contiguous event sequence, strict states,
private permissions, restart persistence, idempotent lifecycle replay, illegal
transitions, lease bounds/ownership/expiry, corruption preservation, guarded API
mutations, browser-client validation, and truthful Studio copy.

## Browser evidence

Against the real local control plane:

1. Created “Prove an immutable zero-effect execution handoff with durable events.”
2. Approved the zero-effect contract and observed its stable digest.
3. Claimed the proof lease; no command or provider was invoked.
4. Recorded the zero-effect checkpoint.
5. Released the lease and observed `completed`.
6. Verified four ordered durable events: approved, claimed, checkpointed, released.
7. Verified Effects `None`, Maximum cost `$0.00`, Undo `Release lease`.
8. Browser console contained zero errors.
9. At 390 × 844, `scrollWidth === clientWidth === 390`.

## Exact limitation

This is a real authority and lifecycle proof, not real code execution. It deliberately
cannot run commands, contact models/providers, mutate project source, perform Git
effects, access credentials, use paid services, or claim validation. The next execution
slice must add each effect behind its own capability, checkpoint, and evidence boundary.
