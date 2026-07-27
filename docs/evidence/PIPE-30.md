# PIPE-30 evidence

## Outcome

Pipeline Studio has executable strict v1 contracts, deterministic migration and
event replay, an explicit compatibility policy, and safe error separation.

## Acceptance criteria

- AC1 — PASS: fixtures cover deterministic legacy-v0 migration, supported-v1
  round trips, namespaced forward extensions, unknown-field rejection, and
  unsupported-major rejection.
- AC2 — PASS: identical event journals reconstruct identical task/lease state;
  gaps and stale revisions fail closed.
- AC3 — PASS: safe errors require owner and next action; tests prove local
  diagnostic detail and causes are absent from serialization.

## Contract coverage

Task, dependency, lease, command, event, model call, tool call, approval,
artifact, validation, review, recovery, external effect, and error.

## Verification

The full locked repository gate—setup, formatting, isolation/secret lint,
strict typecheck, build, and offline tests—must pass before closure. The Jira
completion comment records the final test count and commit.

## Isolation

Only the independent Pipeline Studio repository changed. No external provider,
connector, autonomous worker, or Household component was invoked.
