# PIPE-106, PIPE-107, PIPE-108, and PIPE-172 evidence

## Scope

- PIPE-106: governance roles, decisions, roadmap, triage, moderation, adapter
  ownership, disclosures, succession, and security-emergency procedures.
- PIPE-107: dependency, build, artifact, provenance, signature, secret, and
  license release gates.
- PIPE-108: declared data flows, consent, retention, deletion, third-party AI,
  paid-use separation, and responsible-AI rules.
- PIPE-172: executable supply-chain success, failure, stale, pending, malformed,
  and recovery fixtures.

## Product surface

The `/trust` route presents the same versioned records used by deterministic
domain checks. It links Jira and repository sources. Simulations modify local
demo state only and do not create a package, tag, release, CI run, deployment,
telemetry event, provider change, or issue.

## Verification

- `npm run verify`: 398 tests passed, 0 failed.
- `npm run studio:build`: production build completed successfully.
- Desktop browser review passed in light and dark themes.
- Mobile browser review passed at 390 × 844 with no horizontal overflow.
- The browser console remained clean during the interaction review.
- The provenance-mismatch fixture changed the candidate from Promotion eligible
  to Promotion blocked and exposed the exact remediation.
- Restoring verified evidence reopened the candidate without bypassing a gate.
- Optional telemetry consent changed prospectively, explained its effect, and
  performed no external action.
- Training-eligible free AI reflected the explicit test-pipeline authorization;
  declared flows continued to exclude secrets and personal data.
- Paid usage remained locked off in both the UI and the strict preference
  schema.

The source commit is recorded in the completion comments for PIPE-106,
PIPE-107, PIPE-108, and PIPE-172.
