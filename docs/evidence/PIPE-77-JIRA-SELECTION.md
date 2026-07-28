# PIPE-77 — Visual Jira selection

## Delivered

- Selections retain stable cloud, project, board, issue ID, issue key, and
  source-revision records.
- Unavailable fields remain explicitly unknown instead of being presented as
  absent.
- Private Jira content remains local unless the selected provider data policy
  explicitly permits it.

## Proof

- Domain: `packages/integrations/src/jira.ts`
- Tests: `tests/jira-integration.test.ts`
- UI: `/integrations` → Jira planning import
