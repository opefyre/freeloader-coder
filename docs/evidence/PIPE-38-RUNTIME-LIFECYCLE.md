# PIPE-38 — Local lifecycle, interruption, and repair

Status: verified locally on 2026-07-28.

## Outcome

Pipeline Studio now models controller ownership, local service health,
checkpointed interruption, outcome-unknown effects, bounded recovery, and
non-destructive repair as product contracts.

## Acceptance evidence

- A live controller lease prevents a second controller from owning the same
  profile.
- An interrupted effect is never replayed automatically when its outcome is
  unknown; reconciliation evidence is required first.
- Repair releases only expired ownership, selects a free loopback port,
  rebuilds derived views, and restarts stopped local services.
- Repair plans explicitly preserve projects, credentials, and checkpoints and
  refuse unsafe or manually paused recovery.
- The Studio makes interruption and repair inspectable: users can simulate a
  checkpointed stop, see affected services, and verify the preserved state.

## Verification

- `tests/runtime-lifecycle.test.ts`
- Browser QA exercised interruption and repair. The repaired view reported
  `Repair verified` and confirmed that projects, credentials, and checkpoints
  were preserved.
- Full release gate: 213 tests passed, 0 failed.

