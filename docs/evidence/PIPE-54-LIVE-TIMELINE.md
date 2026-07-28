# PIPE-54 — Truthful live work timeline

Status: verified locally on 2026-07-28.

## Outcome

Plans, progress, technical detail, waiting states, controls, and evidence are
shown in one timeline reconstructed from durable ordered events.

## Acceptance evidence

- Replay and reconnect reconstruct an identical grouped timeline.
- Technical events are collapsed under the related user-facing stage.
- `working` is rendered as active only with both live lease and service
  evidence; otherwise the interface says `Inactive · not progressing`.
- Safe cancellation distinguishes `Stop requested`, `Safely stopped`, and
  `Unable to stop`.
- Browser QA exercised inactive-worker evidence, restoration, and the two-stage
  safe-stop flow without optimistic progress claims.

## Verification

- Full repository verification: 250 passed, 0 failed
- Production Studio build: passed
- Browser errors: 0
