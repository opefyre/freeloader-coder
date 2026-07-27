# Release scorecard

Every candidate release records evidence in each category. A green aggregate
cannot override a critical stop condition.

## Scorecard

| Category | Measures | Classification |
|---|---|---|
| Activation | Preflight, provider ready, project opened, first plan | `ACTIVATION_FAILURE` |
| Provider fabric | Eligibility, canary, quota, route exhaustion, latency | `PROVIDER_FAILURE` |
| Orchestration | Readiness, grounding, graph validity, dependency progress | `ORCHESTRATION_FAILURE` |
| Execution | Worktree, patch application, protected paths, command result | `EXECUTION_FAILURE` |
| Quality | Deterministic checks, reviewer quorum, false completion | `QUALITY_FAILURE` |
| Recovery | Restart, replay, restore, compensation, duplicate effects | `RECOVERY_FAILURE` |
| Trust | Cost, credentials, privacy, permissions, user-work preservation | `TRUST_FAILURE` |
| Experience | Comprehension, accessibility, responsive behavior, help | `EXPERIENCE_FAILURE` |
| Community | Setup success, issue quality, contributor checks, support load | `COMMUNITY_FAILURE` |

## Diagnostic separation

An installation that cannot configure a provider is not counted as execution
failure. A valid plan whose patch does not apply is not counted as activation
failure. Each unsuccessful session records the earliest owning failure class
and may retain secondary contributing classes.

Required fields:

- Release and scorecard version
- Cohort and eligibility count
- Funnel denominator for every percentage
- Primary failure class
- Recovery attempted and outcome
- Known data-quality limitation
- Evidence reference
- Owner and review date

## Hard release stops

Any confirmed occurrence blocks release:

- Paid usage without an explicit user-enabled budget.
- Credential, token, cookie, or private key exposure.
- Loss or destructive overwrite of user work without verified recovery.
- False claim of completion, safety, publication, or successful rollback.
- Permission bypass or external effect without the required approval.
- Analytics containing prompts, source, paths, identifiers, or secrets.
- Critical accessibility failure in setup, approval, review, or recovery.
- Known compromised dependency or unsigned release artifact.

The owner must record containment, affected versions, evidence, remediation,
rollback, and a regression test before the stop can be cleared.

## Decision

- **Ship:** all applicable targets met and no hard stop.
- **Constrained ship:** targets miss within an approved bound, with limitation,
  owner, rollback, and review date; no hard stop.
- **Hold:** any hard stop, unverifiable data, or missing owner.

