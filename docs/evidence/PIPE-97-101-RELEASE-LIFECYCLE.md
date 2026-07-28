# PIPE-97–101 release lifecycle evidence

## Scope

- PIPE-97: strict release manifests, required artifact kinds, digests,
  signatures, reproducible timestamps, checks, provenance, and release blocking.
- PIPE-98: guided update state machine, preservation ledger, migration preview,
  verification, interruption classification, and bounded rollback.
- PIPE-99: current, sourced compatibility across systems, runtimes, providers,
  models, connectors, and project types.
- PIPE-101: staged rollout, promotion gates, incident rehearsal, rollback
  decisions, and version-bound release notes.

## Product surface

The `/releases` route is an interactive local demo. It does not create a tag,
release, update, rollout, issue, deployment, or CI/CD workflow. It links the
source commit, GitHub releases, official compatibility sources, and each Jira
acceptance ticket.

## Verification

- `npm run verify`: 384 tests passed, 0 failed.
- `npm run studio:build`: production build completed successfully.
- Desktop browser review passed in both light and dark themes.
- Mobile browser review passed at 390 × 844 with no horizontal overflow.
- The browser console remained clean during the full interaction review.
- Guided update progressed through preflight and checkpoint creation, handled a
  simulated interruption, and restored version 0.7.3 through the bounded
  rollback action.
- Compatibility search surfaced the experimental Xcode adapter together with
  its source and a safe macOS-worker alternative.
- Incident rehearsal paused canary promotion and exposed the rollback decision
  without triggering any external action.
- Release notes exposed migration, known-limitation, and rollback sections.

The source commit is also recorded in the completion comments for PIPE-97,
PIPE-98, PIPE-99, and PIPE-101.
