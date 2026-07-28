# PIPE-74 — Secure Jira OAuth

## Delivered

- State, PKCE, redirect, expiry, replay, partial consent, resource selection,
  vault-reference, and revocation contracts.
- The broker boundary retains no project content or long-lived user token.
- Broker unavailability does not block local project, task, validation, or
  evidence work.

## Proof

- Domain: `packages/integrations/src/auth.ts`
- Tests: `tests/integration-auth.test.ts`
- UI: `/integrations` → Jira connection card
