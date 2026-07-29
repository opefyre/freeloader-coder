# PIPE-41 — GitHub repository onboarding

## Outcome

A canonical GitHub HTTPS repository can be inspected and cloned into a verified
empty destination without confusing attempted access with successful
registration.

## Acceptance evidence

- Exact owner and repository identity is parsed from canonical HTTPS input;
  malformed, ambiguous, and unsupported hosts fail before any clone effect.
- Access is classified as ready, authentication required, or denied. Private
  access never falls back to a different repository.
- The destination is canonicalized and inspected before mutation. Existing
  content, duplicates, symlink escapes, and unsafe paths return explicit choices.
- Interrupted or failed clone work remains incomplete and supplies a Resume
  verification route.
- Registration observes repository facts after clone and produces the same
  canonical project schema used by local-folder entry.
- No Jira, GitHub, provider, deployment, or paid effect is required by the
  synthetic fixtures.

## Verification

- `tests/onboarding-registration.test.ts`
- `tests/foundation-evidence.test.ts`
- Negative fixtures cover malformed URL, denied access, occupied destination,
  duplicate registration, interruption, and clone failure.

Final repository and browser results are recorded in
`PIPE-35-117-124-ACCESSIBILITY-FOUNDATION.md` and the PIPE-124 Jira completion
comment.
