# PIPE-37 — One-command setup, preflight, and first launch

Status: verified locally on 2026-07-28.

## Outcome

A cloned repository now exposes one supported setup command, a resumable
private setup record, explicit required and optional checks, safe port
selection, and a repair command that preserves existing configuration.

## Acceptance evidence

- `npm run setup` performs the supported preflight and prints the exact next
  launch command.
- Repeated setup reuses the same private state and configuration instead of
  creating duplicate profiles or services.
- Every requirement publishes its state, whether it is required, an exact
  action, a resume action, and an observable verification.
- `npm run repair` repairs only derived local runtime state and preserves
  projects, configuration, credentials, and checkpoints.
- The Studio renders the same journey as a guided, non-technical setup panel.

## Verification

- `tests/runtime-preflight.test.ts`
- `tests/runtime-setup-command.test.ts` executes setup repeatedly and repair
  against isolated temporary state.
- Browser QA exercised preflight, desktop and 390 px mobile layouts, and light,
  system-resolved light, and dark themes. No horizontal overflow was observed.
- Full release gate: 213 tests passed, 0 failed.

