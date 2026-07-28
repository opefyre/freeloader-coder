# PIPE-62 — Visual checkpoints and reversible decisions

## Outcome

Pipeline Studio now exposes the execution lifecycle as named baseline, task, validation, accepted, and published checkpoints with safe keep, restore, conflict, and publish decisions.

## Acceptance evidence

- Checkpoints identify changed files, generated data, conflicts, validation evidence, actor, timestamp, and restore scope.
- Clean changes apply only to task-owned paths while unrelated user changes stay untouched.
- Conflicts always show the current user version and pipeline proposal side by side; neither side is hidden or discarded.
- Guided options cover keeping the current version, using the proposal, opening both for editing, or restoring the validation checkpoint.
- Keep, restore, and publish decisions produce immutable audit records tied to an exact checkpoint and actor.
- The Work UI explains restore impact before action and records the selected decision locally.

## Verification

- `tests/execution-checkpoints.test.ts`
- `tests/studio-execution.test.ts`
- Browser acceptance: opened a conflict, verified both versions and the “nothing is applied” boundary, selected “Keep your version,” and observed the audit receipt.
- Full verification: 190 tests passed, 0 failed; setup, format, lint, typecheck, core build, Studio build, and diff check passed.

