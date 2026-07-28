# PIPE-63 — Resource-aware execution

## Outcome

Pipeline Studio now converts observed machine pressure into truthful Lightweight, Standard, or Distributed execution profiles and can reduce or pause work while preserving resumable state.

## Acceptance evidence

- Resource snapshots cover memory, disk, thermal state, power, sleep, local runtimes, model availability, and concurrent workloads.
- The Lightweight profile gives an 8 GB machine a single-task, 4 GB ceiling with local models disabled, preventing unbounded swap.
- Standard and Distributed profiles reserve capacity for independent review instead of allowing implementation work to consume the machine.
- Memory or workload pressure reduces concurrency; low disk, battery, thermal limits, or sleep pause at a recoverable boundary.
- Every run, reduction, or pause decision includes plain-language reasons, visible limits, and a resumable-state reference.
- The Work UI allows profile switching and shows current resource comfort, remaining protected capacity, and automatic pressure behavior.

## Verification

- `tests/execution-resources.test.ts`
- `tests/studio-execution.test.ts`
- Browser acceptance: switched Standard to Distributed, paused safely, verified a resumable-state explanation, tested light and dark themes, and confirmed zero horizontal overflow at 1280 px and 390 px. Browser console had no warnings or errors.
- Full verification: 190 tests passed, 0 failed; setup, format, lint, typecheck, core build, Studio build, and diff check passed.

