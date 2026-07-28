# PIPE-41 — Safe Git checkpoints

## Outcome

Git state is translated into a versioned checkpoint plan with plain-language safety promises and exact Advanced operations. Existing user work remains outside product-owned checkpoints.

## Acceptance evidence

- Clean, dirty, untracked, nested, detached, large-file, ignored-sensitive, and no-Git states have deterministic guided behavior.
- Existing Git repositories use an isolated branch/worktree plan from the observed baseline.
- No-Git initialization requires explicit approval before the adapter can execute.
- Execution succeeds only after the exact branch and baseline postcondition are observed.
- Restore manifests enumerate only product-owned files and unrelated user paths.
- Restore removes or restores only recorded product files, preserves unrelated work, and stops when a product-owned file has been changed by the user.
- Advanced UI exposes exact checkpoint operations and limitations while Standard mode uses checkpoint and restore language.

## Verification

- `tests/onboarding-checkpoints.test.ts`
- Browser acceptance: Advanced operations and limitations were expanded and inspected; both Keep and Restore journeys completed.
- Full verification: 168 tests passed, 0 failed; all repository and production-build gates passed.

