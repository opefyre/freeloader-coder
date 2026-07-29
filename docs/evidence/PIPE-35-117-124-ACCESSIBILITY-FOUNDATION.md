# Sprint 18 accessibility and foundation evidence

## Scope

- PIPE-35: hard accessibility release gate.
- PIPE-117: repository-boundary evidence for PIPE-29.
- PIPE-118: strict protocol and parity evidence for PIPE-30.
- PIPE-119: generalized-core migration evidence for PIPE-31.
- PIPE-120: current design-system evidence for PIPE-32.
- PIPE-121: clone/setup evidence for PIPE-37.
- PIPE-122: runtime lifecycle evidence for PIPE-38.
- PIPE-123: local repository entry evidence for PIPE-40.
- PIPE-124: GitHub repository entry evidence for PIPE-41.

## Executable ledger

Each evidence ticket maps AC1–AC3 to a current automated or named manual
artifact, an owner, a deliberately broken negative fixture, and the single
reproducible `npm run verify` gate. Strict schemas reject unknown fields and any
fixture claiming to contain sensitive data.

## Product surface

The `/accessibility` route projects the same gate and ledger records. Removing
the chart alternative changes the release decision from eligible to blocked;
restoring its evidence reopens eligibility. Simulations remain local and create
no release, issue, workflow, deployment, provider request, or paid effect.

## Verification

- `npm run verify`: 411 tests passed, 0 failed.
- `npm run studio:build`: production build completed successfully.
- Desktop browser review passed in light and dark themes.
- Semantic browser inspection exposed named tabs, release state, all eight check
  labels, and the chart summary as a captioned table.
- Removing the chart alternative changed the candidate from Release eligible to
  Release blocked with one critical failure and an exact remediation.
- Restoring accessible evidence returned the table and reopened eligibility.
- The foundation view exposed all eight evidence tickets, 24/24 criterion
  mappings, source artifacts, owners, and negative fixtures.
- Initial effective 200% zoom review at 640 CSS pixels found a 94-pixel shared
  header overflow. The responsive breakpoint was corrected and the same check
  passed at 640 pixels with no horizontal overflow.
- Mobile review passed at 390 × 844 with no horizontal overflow.
- The browser console remained clean throughout the interaction review.

The source commit is recorded in the completion comments for PIPE-35 and
PIPE-117 through PIPE-124.
