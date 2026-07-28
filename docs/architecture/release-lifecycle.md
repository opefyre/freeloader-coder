# Release and update lifecycle

Pipeline Studio distributes tagged source releases. CI/CD and automated
deployment remain outside this phase.

## Reproducible release record

Every candidate has one strict manifest containing the semantic version, source
commit, channel, reproducible source timestamp, signer, signature status,
previous compatible version, required checks, and content-addressed artifacts.
The minimum artifact set is source, lockfile, schemas, SBOM, provenance, and
checksums. Duplicate names, missing kinds, unverified signatures, or incomplete
checks block release.

## Compatibility evidence

Compatibility is recorded per operating system, runtime, provider, model,
connector, and project type. Each entry has a constraint, state, explanation,
safe alternative, official source, evidence owner, verification time, and
review deadline. Stale or unknown evidence cannot silently become supported.
Experimental entries require an explicit choice.

## Guided update state machine

The canonical stages are:

`available → preflight → checkpointed → migration_preview → applying → verifying → complete`

An interrupted or failed apply can move to
`rollback_ready → rolling_back → restored`. Uncertain preservation moves to
`needs_user`. The pipeline cannot enter migration, apply, or verification
without both a project checkpoint and database backup. Active work, insufficient
disk, unverified signatures, and blocked/unknown/stale compatibility stop before
source changes.

## Rollout and incidents

Promotion is draft, canary, beta, then stable. Each transition requires current
evidence, elapsed observation, an acceptable failure rate, a passed rollback
exercise, and no critical incident. A release incident pauses promotion.
Critical severity, lost integrity, or duplicate effects block the release;
rollback is recommended when a verified compatible version exists.

Release notes record highlights, migrations, compatibility changes, known
limitations, and the rollback version. Model judgment may help summarize
evidence but cannot approve a release, update, migration, or rollback.
