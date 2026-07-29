# PIPE-407–451 — Decision Inbox evidence

## Delivered

- Strict shared Decision Inbox contracts and privacy-safe export schema.
- Deterministic aggregation, priority, aging, ownership, ordering, identity,
  deduplication, facets, summaries, and safe canonical references.
- Live read-only loopback endpoint and bounded typed client.
- Lazy `/decisions` route, desktop/mobile navigation, and notification entry.
- Responsive live metrics, four priority lanes, facets, search, inspector,
  local export, all-clear, filtered-empty, stale, and offline states.
- Automated aggregation, privacy, API, client, routing, registry, and UI
  contract coverage.

## Trust claims

- Automatic spend is structurally `$0`.
- The inbox cannot approve, retry, mutate, publish, or call a provider.
- No healthy or terminal observation is represented as a blocker.
- Missing data is not represented as resolution.
- Credentials, personal paths, prompts, source bodies, and provider bodies are
  excluded from snapshots and exports.
- Retention is bounded current state, not an unlimited audit archive.

## Verification

The release is accepted only after repository verification, production Studio
build, bundle-budget checks, and live browser interaction checks all pass.
The final Git commit and Confluence release page are attached to every Jira
ticket before the sprint is closed.
