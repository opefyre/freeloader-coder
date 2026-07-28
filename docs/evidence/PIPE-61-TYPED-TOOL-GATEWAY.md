# PIPE-61 — Typed and auditable tool gateway

## Outcome

Pipeline Studio now has a strict tool boundary for reading, searching, patching, formatting, bounded commands, Git operations, screenshots, previews, artifacts, and checkpoints.

## Acceptance evidence

- Every invocation declares a versioned schema, isolation mode, paths, effects, network hosts, command recipe, environment references, limits, and timeout.
- Traversal, protected paths, symbolic links, unknown schemas, undeclared effects, unapproved commands, disallowed hosts, and unavailable isolation capabilities are refused before execution.
- Observed effects cannot exceed declared effects after execution.
- Receipts record redacted input and output summaries, exit status, duration, observed effects, and artifact references.
- Large or sensitive output is summarized; the complete output remains a local artifact and credentials are redacted.
- The Work UI exposes the available tool families and the effect boundary of each one without implying unrestricted shell access.

## Verification

- `tests/execution-tools.test.ts`
- Interactive Studio verification: all explicit tool cards rendered with their allowed effect and the unknown-tool refusal rule.
- Full verification: 190 tests passed, 0 failed; setup, format, lint, typecheck, core build, Studio build, and diff check passed.

