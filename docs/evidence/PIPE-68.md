# PIPE-68 — Source-backed operational metrics

## Current delivered slice

The Control Center now has a strict, versioned operational-metric boundary and
a complete synthetic fixture for every metric family required by the story.
The four overview summary cards consume those records rather than embedding
their numeric values directly in the component.

## Provenance contract

Every metric records:

- authoritative source event types;
- project and time-range scope;
- observation timestamp;
- fresh, stale, or missing state;
- count, sum, ratio, duration, or latest aggregation;
- whether the value is estimated;
- an explicit unit.

Missing metrics must carry `null`. The schema rejects any missing record that
silently reports zero or another value.

## Covered metric families

Throughput, stage duration, queue, active leases, retries, provider calls, input
tokens, output tokens, quota remaining, fallbacks, validations, reviews,
healing, needs-user, quarantined, and recoveries.

## UI behavior

Summary cards expose freshness and observation time. Their source events remain
available as contextual evidence. Provider execution continues to use the
separate provider-attempt telemetry projection so external providers are not
collapsed into one decorative series.

## Remaining work before Done

- Project the contracts from a persistent event store rather than fixtures.
- Add explicit stale and missing UI scenarios across all visualizations.
- Add selected time-range filtering and local-provider attempts.
- Independently review the data semantics and release evidence.
