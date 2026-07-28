# PIPE-42 — First validated-preview journey

## Outcome

The Projects workspace provides a complete five-stage first-run journey: Add project, Understand, Review plan, Validate, and Keep or Restore.

## Acceptance evidence

- Starter tasks are derived from the project profile and limited to read-only or reversible local effects.
- The recommended visible-change journey is budgeted at eight minutes.
- The pre-run plan explains expected time, automatic free-model use, low-impact local resources, effects, evidence, and undo without requiring provider, routing, command, or Git terminology.
- The preview distinguishes a temporary visual result from validation evidence and a restorable checkpoint.
- Keep and Restore both preserve unrelated work and complete with explicit outcomes.
- Completion, abandonment, and failure events contain only hashed project identity, stage, outcome, failure class, and time; strict schemas reject prompts, paths, and content.
- Responsive controls, keyboard focus states, semantic progress, pressed states, and `aria-live` outcomes are present.

## Interactive acceptance

1. Completed GitHub entry through Analyze, Plan, Preview, and Restore.
2. Completed local-folder entry through Analyze, Plan, Preview, and Keep.
3. Expanded Advanced checkpoint details.
4. Verified light and dark themes.
5. Verified no horizontal overflow at the 1512-pixel acceptance viewport.

## Verification

- `tests/onboarding-journey.test.ts`
- `tests/studio-onboarding.test.ts`
- Full verification: 168 tests passed, 0 failed; typecheck, lint, formatting, setup, core build, Studio build, and diff check passed.

