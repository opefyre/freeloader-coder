# PIPE-73 — Verified GitHub publishing

## Delivered

- Checkpoint publishing plans an editable target branch, commit, and pull
  request from observed changed files and checks.
- Guided and Balanced modes require explicit approval.
- A deterministic idempotency key prevents duplicate pull requests on retry,
  and completion requires observed GitHub postconditions.

## Proof

- Domain: `packages/integrations/src/github.ts`
- Tests: `tests/github-integration.test.ts`
- UI: `/integrations` → Publish verified checkpoint
