# PIPE-60 — Isolated execution workspaces

## Outcome

Pipeline Studio now models every task run as a unique, recoverable execution workspace with verified ancestry, a dedicated branch, an explicit isolation profile, and bounded cleanup.

## Acceptance evidence

- Concurrent task attempts receive unique workspace and branch identities and cannot target the user workspace directly.
- Strong container, native bounded, and paired remote modes publish truthful capability sets.
- Reduced isolation cannot request host mounts, unrestricted network access, or secret references reserved for stronger profiles.
- Workspace state includes the verified baseline, current head, lifecycle state, recovery deadline, and an integrity digest.
- Abandoned work remains recoverable during a bounded retention window before cleanup becomes eligible.
- Safe pause preserves the branch, baseline, artifacts, and a new resumable state digest.

## Verification

- `tests/execution-isolation.test.ts`
- Interactive Studio verification: strong-isolation status, task-branch scope, safe pause, and resumable-state explanation rendered correctly.
- Full verification: 190 tests passed, 0 failed; setup, format, lint, typecheck, core build, Studio build, and diff check passed.

