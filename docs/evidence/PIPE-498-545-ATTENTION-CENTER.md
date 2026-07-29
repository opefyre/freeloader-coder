# PIPE-498–545 — Attention Center

## Delivered

- Strict shared contracts for attention identity, severity, category,
  lifecycle, query, snapshot, quiet hours, previews, receipts, and mutations.
- Canonical aggregation from the live Decision Inbox and verified completion
  observations.
- Stable fingerprinting, deterministic ordering, privacy redaction, bounded
  facets, and exact badge computation.
- Private restart-safe disposition and preference state with atomic writes,
  serialization, revision binding, idempotent replay, conflict detection,
  bounded receipts, snooze expiry, and retention pruning.
- Loopback read, preview, action, and quiet-hours APIs.
- Typed browser client with loopback, no-store, credential omission, size,
  cancellation, and schema guards.
- Live global bell and preview plus a full responsive `/attention` workspace.
- Universal Command Center indexing for current attention and the Attention
  destination.

## Safety invariants

- Automatic spend: `$0`.
- Critical alerts bypass quiet hours.
- Acknowledgement and snooze never alter task or provider state.
- No external write or provider request is connected.
- No fixture badge or stale-success substitution.
- Credentials, prompts, source/provider bodies, and personal paths are absent.

## Deterministic evidence

- Full repository verification: `551/551` tests passed.
- Release checks passed: setup, formatting, lint, typecheck, build, route
  integrity, and bundle budgets.
- Studio entry bundle: `394.20 kB` against the `450 kB` budget.
- Lazy Attention workspace: `27.26 kB` raw / `8.73 kB` gzip.
- Live browser walkthrough passed in light and dark modes: canonical unread
  count, preview, confirmation, durable acknowledgement receipt, and the
  15-second badge refresh to all-clear.
- `tests/attention-center.test.ts`
- `tests/attention-api-client.test.ts`
- `tests/studio-attention-center.test.ts`
- Updated Decision Inbox and universal-search regression coverage.

## Rollback

Revert the delivery commit. The private
`.pipeline-studio/attention-state.json` file is inert without the feature and
can be preserved for a later restoration. Reverting does not change request,
Git, provider, Jira, or GitHub state.
