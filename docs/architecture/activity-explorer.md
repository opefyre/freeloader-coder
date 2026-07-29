# Activity Explorer

## Purpose

Activity Explorer answers **what happened, when, why, and where can I inspect
the canonical source?** It is a read-only projection. Requests, projects,
providers, and the autonomy coordinator remain authoritative.

## Sources

| Source family | Canonical input | Public reference |
| --- | --- | --- |
| Request summary | Durable local request | Work |
| Request run | Contiguous run-event journal | Work |
| Project observation | Bounded project registry | Projects |
| Provider connection | Public connection metadata | Providers |
| Autonomy recommendation | Revision-bound coordinator snapshot | Work |
| Autonomy lease | Single-owner coordinator lease | Work |
| Autonomy receipt | Durable safe-step receipt | Work |

The aggregation does not read prompts, source files, credentials, provider
response bodies, or canonical filesystem paths.

## Event contract

Every event has a content-derived opaque identity, kind, deterministic severity,
source family, bounded source record reference, canonical state, safe title and
detail, observation time, optional opaque project/request/provider references,
and an internal Studio link.

Events are reverse chronological with identity as the deterministic tie-breaker.
Conflicting duplicate identities fail closed. Unknown future states remain
neutral instead of being guessed into success or failure.

## Query semantics

`GET /api/v1/activity` supports:

- `range`: `1h`, `24h`, `7d`, or `all`;
- repeated `kind`;
- repeated `severity`;
- one opaque `project`;
- one bounded provider identifier;
- normalized `search` up to 80 characters.

Unknown parameters, duplicate facets, invalid identities, bodies, unsupported
methods, and remote browser origins are rejected. Filters are conjunctive.
Facet counts describe the selected time range before facet filters, so removing
a filter remains understandable.

## Retention truth

The explorer is a bounded current-state projection, not an immutable enterprise
audit archive. It returns at most 250 events and publishes its earliest included
observation. Empty history, filtered-empty history, and unavailable history are
different states.

## Privacy and export

The public boundary redacts credential-shaped values and personal paths, bounds
all strings, and excludes prompts, source content, and provider bodies by
construction. Export is created locally from the already validated displayed
snapshot. It has no network or server-side archival effect.

## Failure behavior

The client retains the last valid snapshot when refresh fails, labels it stale,
and never infers new progress. With no valid snapshot, it shows an offline state
instead of sample history. The user may retry a read-only observation.

## Verification

```sh
npm run verify
npm run studio:release-check
```

Tests cover source mapping, deterministic severity, unknown states, ordering,
stable identity, ranges, conjunctive filters, summaries, facets, secret/path
redaction, export validation, query rejection, origins, response bounds,
routing, UI interactions, fallback states, and accessibility contracts.
