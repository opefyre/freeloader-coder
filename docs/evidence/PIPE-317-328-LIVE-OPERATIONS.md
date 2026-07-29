# PIPE-317–328 — Live operations milestone

## Outcome

Pipeline Studio's Overview route now reports canonical local operational state
instead of importing synthetic dashboard fixtures. The milestone covers the
versioned contract, aggregation, loopback API, resilient browser client,
interactive dashboard, provider readiness, truthful fallback states,
accessibility, deterministic tests, and product-truth documentation.

## Source map

| Capability | Owned source |
| --- | --- |
| Strict public contract | `packages/runtime/src/live-operations.ts` |
| Canonical aggregation and redaction | `apps/core/src/live-operations.ts` |
| Protected read-only route | `apps/core/src/control-plane.ts` |
| Runtime composition | `apps/core/src/control-plane-main.ts` |
| Bounded loopback client | `apps/studio/src/live-operations-client.ts` |
| Live interactive Overview | `apps/studio/src/components/control-center/control-center.tsx` |
| Contract, API, privacy, and client proof | `tests/live-operations.test.ts` |
| UI behavior and anti-fixture proof | `tests/studio-control-center.test.ts` |

## Trust boundaries

- The endpoint is available only through the existing loopback control plane.
- Cross-origin requests remain allowlisted; foreign origins and write methods
  fail closed.
- Responses are strict, bounded, non-cacheable, and carry local provenance plus
  a freshness window.
- Credentials are never read by the aggregator. Common credential-shaped text
  and personal home-directory segments are redacted from request summaries.
- Provider readiness requires active credentials, admitted evidence,
  zero-cost status, and billing disabled.
- Automatic spend remains structurally fixed at `$0`.
- Offline or malformed responses never become live data. The browser preserves
  the last valid observation as stale and never fills gaps with fixtures.

## User states

The Overview route distinguishes:

1. connecting;
2. live and healthy;
3. healthy idle;
4. needs attention;
5. no registered activity;
6. no connected provider;
7. stale preserved observation; and
8. offline control plane.

Cards, stage bars, events, and provider rows are keyboard-operable and navigate
to the corresponding real workspace. The stage chart includes a complete text
alternative through its accessible label.

## Verification

Run:

```sh
npm run typecheck
npm run lint
npm test
npm run studio:release-check
```

Negative coverage includes remote endpoints, oversized responses, malformed
schemas, foreign origins, unsupported methods, interrupted work, absent
providers, credential-shaped request text, and personal filesystem paths.

## Known limits

- The activity stream combines durable request run events with the latest
  canonical project and provider observations; it is not a full external audit
  log.
- Provider usage volume is not inferred when an account does not expose it.
- The dashboard does not pause, retry, or mutate work. Consequential controls
  remain on their owned workflows with their existing approvals.
