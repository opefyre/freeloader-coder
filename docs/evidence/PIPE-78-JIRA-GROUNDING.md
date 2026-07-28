# PIPE-78 — Grounded Jira task graphs

## Delivered

- Every derived task cites the source Jira issue revision and project-grounding
  digest.
- Changed Jira revisions become stale before consequential execution.
- Ambiguity becomes focused clarification, and an existing active graph is
  returned instead of creating a duplicate.

## Proof

- Domain: `packages/integrations/src/jira.ts`
- Tests: `tests/jira-integration.test.ts`
- UI: `/integrations` → Task graph preview
