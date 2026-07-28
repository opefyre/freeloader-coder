# PIPE-75 — Separately governed GitHub Models

## Delivered

- `models:read` is independent from all repository permissions.
- Admission checks enabled state, exact permission, model catalogue, billing
  state, quota evidence, and personal or organization attribution.
- Model permission decisions explicitly report that repository access did not
  change.

## Proof

- Domain: `packages/integrations/src/github.ts`
- Tests: `tests/github-integration.test.ts`
- UI: `/integrations` → GitHub Models
