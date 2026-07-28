# Quality and evidence engine

Pipeline Studio treats completion as a reproducible release decision. Model agreement is advisory; deterministic checks, inspectable artifacts, independent review, and bounded recovery are authoritative.

## Validation

Project checks declare kind, command, environment, required status, and changed-path scope. Required gates always run. Optional checks use changed-scope selection without weakening required coverage. Each observation retains an explicit outcome: passed, failed, warning, skipped, unavailable, timeout, crash, flaky, not applicable, or authorized waiver.

Reports bind the source, ordered validation plan, results, artifacts, and logs with stable digests. A failed required check blocks readiness. Waivers require an identified authorized user and a stated consequence.

## Evidence

Changed code always produces diff and validation artifacts. Bundles may also include commands, logs, builds, commits, reviewer findings, limitations, and visual proof. Visual failure blocks UI work but cannot misclassify valid non-UI work. Every artifact is stable, downloadable, and invalidated when its source changes.

## Review

Reviewers receive the same task contract, grounding, diff, validation, and prohibited-action rules. UI work requires functional and design roles. At least one reviewer provider must be independent from the implementer. Findings carry severity, evidence, confidence, affected acceptance criterion, and recommended repair.

Critical evidence-backed dissent blocks readiness. Provider consensus cannot override deterministic failure.

## Healing

Failures are classified as implementation, environment, flaky, provider, contract, product decision, or unsafe. Automated repair is limited by attempt budget, accepted files, protected paths, required checks, required review roles, and golden-workflow score.

Recovery must rerun affected validation and review. Scope expansion, protected-path access, exhausted budgets, unsafe failures, or golden regressions become `Needs you` or `Quarantined` with preserved evidence.
