# Product governance

This directory is the authoritative decision and release-control system for
Pipeline Studio. Jira tracks delivery; these versioned records preserve why a
decision was made, what evidence supports it, and how to reverse or replace it.

## Required records

Create a record before implementation when work changes:

- product behavior or user promises;
- architecture, schemas, APIs, events, or compatibility;
- security, privacy, accessibility, or data handling;
- providers, connectors, credentials, permissions, or paid usage;
- destructive or difficult-to-reverse behavior;
- a release gate, experiment, risk acceptance, or deprecation.

Use the templates in `templates/`:

- `ADR-NNN-title.md` for technical and architectural decisions;
- `PD-NNN-title.md` for product policy and behavior;
- `EXP-NNN-title.md` for a bounded experiment;
- `RISK-NNN-title.md` for risk acceptance or remediation;
- `DEP-NNN-title.md` for a deprecation.

IDs are monotonically increasing within each record type. Records are never
deleted or silently rewritten after acceptance. Corrections are appended;
replacement happens through `Superseded by`.

## Lifecycle

`Draft` → `Proposed` → `Accepted` or `Rejected` → optionally `Superseded`

Only an Accepted record authorizes affected implementation. A Proposed or
unresolved decision blocks affected work. An experiment may run only inside
its approved scope and stop conditions.

## Epic readiness contract

Before an epic enters In Progress, its Jira description or first progress
comment must link:

1. every required decision/risk/experiment record;
2. its measurable exit evidence;
3. its owner and approvers;
4. dependencies and unresolved policy questions;
5. rollback or replacement route.

If a required link is missing, the epic is `NOT READY`; an agent must flag the
gap and cannot invent a policy to continue.

## Audit rules

- Decision records, Jira keys, commits, and evidence files cross-link by stable
  identifier.
- Approval is explicit and attributable; silence is not approval.
- Paid usage is disabled by default and requires an explicit, recorded owner
  approval for the exact provider, budget, duration, and stop condition.
- Model output can propose a decision but cannot approve one.
- Secrets, personal data, prompts, source code, and full local paths do not
  belong in analytics or public records.
- Standard and Advanced views must project the same canonical state.

See [approval-matrix.md](approval-matrix.md) and
[release-gates.md](release-gates.md).
