# PIPE-76 — Safe GitHub project import

## Delivered

- Repository access is checked against stable selected IDs and exact contents
  permission.
- Unrelated destination folders are blocked, while divergence creates a guided
  conflict and preserves checkpoints.
- LFS, submodule, and large-file conditions produce explicit preflight
  warnings.

## Proof

- Domain: `packages/integrations/src/github.ts`
- Tests: `tests/github-integration.test.ts`
- UI: `/integrations` → Repository entry
