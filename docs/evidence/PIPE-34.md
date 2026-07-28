# PIPE-34 — Reusable trust-language patterns

## Acceptance mapping

### AC1 — comprehension and action selection

- `tests/content-patterns.test.ts` proves each pattern exposes one deterministic
  primary action.
- Standard visible copy is projected from the same versioned record used by
  Advanced detail; technical codes and diagnostics are excluded from the
  Standard projection.
- The Studio Conversation surface renders the shared approval pattern instead
  of maintaining page-specific approval copy.

### AC2 — approval decision facts

Every approval record is rejected unless it includes:

1. what changes;
2. where it changes;
3. whether it costs money, including an explicit maximum for paid use; and
4. whether and how the action can be undone.

The Studio renders these through `approvalFacts`, so the display cannot silently
omit one required field.

### AC3 — preserved work and recommended action

Every error record requires:

- what happened;
- what work remains preserved;
- one recommended action;
- one alternative action; and
- bounded retry state.

Standard copy inspection rejects blame, false certainty, stack-trace shapes,
full local paths, and unexplained diagnostic codes.

## Covered patterns

- plan steps and outcomes;
- assumptions and questions;
- local and external effects;
- free, paid, and unknown-cost approvals;
- errors and bounded retries;
- recovery alternatives;
- before/after summaries;
- “what this means” explanations;
- evidence-backed completion language.

## Trust boundaries

- Strict version-1 schemas reject unknown fields.
- Paid approvals without an explicit maximum charge are invalid.
- Advanced technical codes/details are stored separately and do not appear in
  Standard visible copy.
- Example actions remain visibly demo-only and perform no local or external
  effect.

## Verification

- `npm run verify`: passed.
- 95 automated tests: passed.
- `npm run studio:build`: passed.
- Shared approval pattern rendered from the canonical typed example: passed.
- Desktop dark-mode Conversation review: passed.
- Mobile review at 390 × 844: passed.
- Mobile horizontal overflow: none (`scrollWidth` = `clientWidth` = 390).
- Onest remains the computed runtime typeface.
- Fresh browser console warnings/errors: none.
