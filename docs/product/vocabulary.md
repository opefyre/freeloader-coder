# Product vocabulary

Version: 1.0  
Owner: Product  
Jira: [PIPE-26](https://opefyre.atlassian.net/browse/PIPE-26)

This vocabulary is canonical across UI, notifications, help, support bundles,
analytics labels, and accessibility announcements.

## Core objects

| Standard term | Technical equivalent | Definition |
|---|---|---|
| Project | Git repository and configured project record | The bounded source tree Pipeline Studio may understand and change |
| Starting point | Baseline commit | Immutable Git commit from which the work begins |
| Change | Isolated worktree and branch | Proposed repository modifications not yet accepted |
| Request | Intent record | User outcome plus constraints, permissions, and privacy policy |
| Plan | Validated task graph | Ordered, dependency-safe work required for the request |
| Step | Task node | One bounded unit with scope, checks, and retry budget |
| Worker | Execution process | Process holding a valid lease and performing one step |
| AI provider | Provider adapter | Service or local runtime that supplies model inference |
| AI model | Model route | Specific eligible model selected for a role |
| Check | Deterministic validation | Command or observable assertion with recorded output |
| Review | Independent evaluation | Functional, design, security, or policy assessment |
| Evidence | Immutable artifact reference | Result proving or disproving a required postcondition |
| Restore point | Checkpoint or snapshot | Verified state to which work can be returned |
| Tool | Permissioned effect adapter | Versioned operation with declared permissions and outcome |

## Terms reserved for Advanced mode

Advanced details may use worktree, task graph, dependency edge, lease, route,
circuit breaker, idempotency key, event sequence, schema version, compensation,
and quarantine.

Every critical Advanced term requires a consequence-first explanation. Example:

> Worker lease expired. The worker stopped responding. Your verified checkpoint
> remains available; restart from it or inspect the last activity.

## Prohibited vague language

Do not use:

- “The AI handled it.”
- “Everything looks good.”
- “It should work.”
- “Probably safe.”
- “Successfully attempted.”
- “Done” when only generation or patch application occurred.
- “No issues” when a required check did not run.

Use the exact verified state, missing evidence, and next action.

## Cross-surface contract

- UI labels and notifications use Standard terms by default.
- Help entries define the Standard term before its technical equivalent.
- Support bundles store canonical state codes and render both terms.
- Analytics records canonical codes, never translated display strings.
- Accessibility announcements describe the state change and consequence.
- Localization translates display text, never identifiers or postconditions.

