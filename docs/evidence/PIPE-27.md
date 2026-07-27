# PIPE-27 evidence

## Outcome

Pipeline Studio now has a versioned product-decision, change-control, and
release-gate workflow that blocks policy invention and preserves auditable
replacement and rollback paths.

## Acceptance criteria

- AC1 — PASS: the epic readiness contract requires links to decisions,
  measurable exit evidence, owners, dependencies, and rollback routes.
- AC2 — PASS: only Accepted records authorize implementation; unresolved
  required policy explicitly produces `NOT READY`.
- AC3 — PASS: immutable accepted records, `Superseded by`, replacement
  triggers, compatibility windows, and rollback evidence preserve an audit
  trail.

## Delivered evidence

- `docs/governance/README.md`
- `docs/governance/approval-matrix.md`
- `docs/governance/release-gates.md`
- ADR, product decision, experiment, risk, and deprecation templates

## Verification

- Markdown structure and internal relative links inspected.
- Required domains, blocking language, evidence, supersession, rollback, paid
  opt-in, accessibility, privacy, and support gates searched deterministically.
- `git diff --check` passes before commit.

## Isolation

This work exists only in the independent `pipeline-studio` repository. No
Household application, Household pipeline source, configuration, task state,
service, or deployment was changed.
