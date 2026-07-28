# PIPE-44 — Bounded project scan and grounding

## Outcome

Pipeline Studio now builds a deterministic, versioned project profile from bounded inputs and clearly separates observed facts, inferences, assumptions, and user decisions.

## Acceptance evidence

- Detects languages, frameworks, package managers, commands, ports, repository conventions, design tokens, protected paths, tests, unsupported features, missing dependencies, and resource requirements.
- Scan limits bound file count, per-file bytes, total bytes, duplicate paths, and output sizes.
- Citations store project-relative paths and SHA-256 digests; unchanged inputs reproduce the same source and grounding digests.
- Relevant file changes invalidate both digests.
- Likely secret-bearing files are excluded from content analysis. Secret-like values in other files are redacted before detection.
- The model-facing projection contains only classified statements and citations—never source contents or secret values.
- Studio analysis visibly separates facts, inferences, assumptions, user decisions, citations, and never-grounded paths.

## Verification

- `tests/onboarding-scanner.test.ts`
- Browser acceptance: project facts, classifications, citations, protected paths, readiness, and safe next action rendered correctly.
- Full verification: 168 tests passed, 0 failed; all repository and production-build gates passed.

