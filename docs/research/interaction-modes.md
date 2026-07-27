# Standard and Advanced interaction modes

Both modes are projections of the same canonical task, event, policy, and
evidence records. Switching modes never changes execution semantics.

## Standard mode

Use familiar language:

- “Project” instead of repository root.
- “Planned” instead of task graph materialized.
- “Working” instead of lease active.
- “Checking the change” instead of validation stage.
- “Ready to review” instead of review-ready terminal state.
- “Needs your decision” instead of needs-user.
- “Stopped after repeated failures” instead of quarantined.
- “Restore point” instead of snapshot or checkpoint.

Standard mode must still show:

- What is happening now.
- What changed.
- What has been verified.
- What remains uncertain.
- Whether any external action occurred.
- Whether money can be spent.
- The recommended next action.

## Advanced mode

May additionally show:

- Task graph and dependency edges.
- Provider, model, route, quota, and circuit state.
- Leases, attempts, retry classes, and failure budgets.
- Worktree, branch, commit, and artifact identifiers.
- Raw deterministic-check output with redaction.
- Event sequence and schema version.
- Tool permissions and idempotency records.

## Migration between modes

- A persistent user preference controls the default presentation.
- Any Standard-mode evidence card can expand into its Advanced representation.
- Deep links preserve the selected task and evidence item.
- Advanced actions use the same permission and confirmation policy.
- Returning to Standard mode cannot hide an unresolved critical warning.

## Comprehension rule

No critical decision may depend only on an internal term. If a term such as
“lease expired” is important, the primary message must explain its consequence:
“The worker stopped responding. Your changes remain isolated and safe. Restart
the task from its last verified checkpoint.”

