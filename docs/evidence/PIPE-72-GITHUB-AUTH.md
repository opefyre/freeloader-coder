# PIPE-72 — Granular GitHub authorization

## Delivered

- Short-lived state/PKCE authorization sessions with HTTPS or loopback redirect
  enforcement, replay prevention, requested-scope containment, and vault-only
  credential references.
- Repository IDs and identity, contents, PR, issues, Actions, and Models
  permissions remain explicit.
- Revoked and organization-denied grants stop new effects without losing local
  work.

## Proof

- Domain: `packages/integrations/src/auth.ts`
- Tests: `tests/integration-auth.test.ts`
- UI: `/integrations` → GitHub connection card
