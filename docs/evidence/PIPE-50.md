# PIPE-50 — Provider routing reliability increment

## Delivered

- Replaced the generic daily-token quota with provider-native request, token,
  neuron, provider-reported, and unmetered capacity contracts.
- Added model-specific context and output headroom, deterministic provider/model
  identity validation, structured rejection reasons, and reset estimates.
- Added exact classification for rate limits, gateway interruptions, permission
  failures, policy failures, and transient provider failures.
- Free-capacity deferrals and gateway interruptions no longer consume task
  attempts or quarantine otherwise valid work.
- Added separate infrastructure-failure escalation that preserves resumable task
  state.
- Added truthful provider telemetry separating configured state, successful
  calls, failed calls, observed usage, cooldowns, and budget source.
- Added an interactive, explicitly demo-scoped Provider Mesh to the Studio
  control center.
- Corrected the test script so direct test runs always compile fresh sources
  before execution.

## Acceptance-criteria evidence

- AC1 — PASS: deterministic routing inputs and structured rejection evidence are
  covered by `tests/provider-routing-parity.test.ts`.
- AC2 — PARTIAL: fallback selection and non-destructive retry semantics are
  implemented and tested; canonical persisted idempotency-chain integration
  remains for the worker/runtime increment.
- AC3 — PASS: provider-reported and provider-native free-capacity exhaustion
  returns a defer decision with a reset estimate and never selects paid usage.

## Verification

- `npm run verify`: passed.
- 60 fresh-build automated tests: passed.
- Desktop browser smoke test: passed.
- Provider selection interaction and limited-capacity detail: passed.
- A browser-only import leak to the server-side cache module was found during
  visual QA and fixed with browser-safe direct module imports.

## Limitations and next work

- The Provider Mesh currently uses synthetic demo evidence and is labelled as
  such. A runtime adapter must replace the fixture before live claims are shown.
- Persisted worker scheduling, route-event storage, and end-to-end idempotency
  integration are not claimed complete in this increment.
