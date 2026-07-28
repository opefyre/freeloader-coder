# PIPE-79 — Truthful Jira synchronization

## Delivered

- Exact status, comment, commit, pull-request, and evidence changes are
  previewed before the external write.
- `Done` is blocked without deterministic checks and review quorum, and can
  never be inferred from model output.
- Source conflicts and revoked permissions preserve local work; idempotency
  markers prevent duplicate comments, links, or transitions.

## Proof

- Domain: `packages/integrations/src/sync.ts`
- Tests: `tests/jira-integration.test.ts`
- UI: `/integrations` → Synchronize Jira evidence
