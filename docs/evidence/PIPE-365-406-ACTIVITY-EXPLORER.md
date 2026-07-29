# PIPE-365–406 — Activity Explorer milestone

## Delivered claim

Pipeline Studio now exposes a live, searchable, filterable, source-linked, and
privacy-safe operational history at `/activity`. It uses canonical local
request, project, provider, and autonomy evidence and performs no external or
paid effect.

## Owned implementation

| Area | Source |
| --- | --- |
| Versioned contracts and export schema | `packages/runtime/src/activity.ts` |
| Canonical aggregation and redaction | `apps/core/src/activity-explorer.ts` |
| Loopback query route | `apps/core/src/control-plane.ts` |
| Runtime composition | `apps/core/src/control-plane-main.ts` |
| Typed browser client and local export | `apps/studio/src/activity-client.ts` |
| Live Activity workspace | `apps/studio/src/components/activity/activity-explorer.tsx` |
| Route and navigation | `apps/studio/src/routing.ts`, `apps/studio/src/App.tsx` |
| Aggregation/privacy proof | `tests/activity-explorer.test.ts` |
| API/client proof | `tests/activity-api-client.test.ts` |
| UI contract proof | `tests/studio-activity-explorer.test.ts` |

## Negative proof

- Unknown query parameters and duplicate facets fail closed.
- Search, identifiers, response bodies, and exports are bounded.
- Remote and credential-bearing endpoints are refused.
- Unsupported methods and request bodies cannot mutate activity state.
- Credential-shaped text and personal paths are redacted.
- Prompts, source content, and provider bodies are not inputs.
- Unknown future states remain neutral.
- Offline UI never substitutes fixture history.
- Stale UI preserves the last valid observation without inferred progress.
- Automatic spend remains structurally `$0`.

## Browser acceptance

Verify direct `/activity` loading, light and dark themes, time-range selection,
kind and severity filters, bounded search, stable timeline selection, detail
references, redacted export, filtered-empty recovery, and responsive reflow.

## Known limits

- History is a maximum-250-event current-state projection, not a permanent
  compliance archive.
- Facets are calculated over the selected time range before facet filters.
- Cross-surface references open the canonical Studio surface; they do not
  execute or approve work.
- Export is a local browser download and is not automatically backed up.
