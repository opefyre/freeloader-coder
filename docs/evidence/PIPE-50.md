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
- Added a strict, versioned, append-only provider journal with atomic local
  persistence, full recorded routing inputs, canonical task/work identity, and
  deterministic replay.
- Added cross-process execution leases with renewal, stale-lock recovery, and
  ownership-checked release to prevent concurrent duplicate model calls.
- Added a core runtime service that isolates journals by safe task and work-unit
  identifiers.
- Added Advanced-mode route evidence explaining the selected route, eligible
  fallbacks, unavailable providers, and paid-use policy.
- Corrected the test script so direct test runs always compile fresh sources
  before execution.

## Acceptance-criteria evidence

- AC1 — PASS: complete privacy-safe routing inputs are persisted per run and a
  fresh replay produces the same selection and rejection reasons.
- AC2 — PASS: provider fallback preserves one journaled task/work identity,
  one monotonic run, unique attempt idempotency keys, one terminal output, and
  returns that output after restart without another provider call. A concurrent
  second worker is rejected by the execution lease.
- AC3 — PASS: provider-reported and provider-native free-capacity exhaustion
  returns a defer decision with a reset estimate and never selects paid usage.

## Verification

- `npm run verify`: passed.
- 70 fresh-build automated tests: passed.
- Desktop browser smoke test: passed.
- Provider selection interaction and limited-capacity detail: passed.
- A browser-only import leak to the server-side cache module was found during
  visual QA and fixed with browser-safe direct module imports.

## Limitations and next work

- The Provider Mesh currently uses synthetic demo evidence and is labelled as
  such. A runtime adapter must replace the fixture before live claims are shown.
- The runtime is local-file backed for the supported single-machine-first
  architecture. Distributed coordination is intentionally outside this ticket.
