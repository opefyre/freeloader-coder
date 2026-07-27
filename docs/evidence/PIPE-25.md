# PIPE-25 acceptance evidence

## AC1 — Privacy-safe metrics

Pass.

`docs/product/success-metrics.md` defines an allowlist of bounded properties and
explicitly forbids prompts, outputs, source, diffs, filenames, paths,
identifiers, secrets, screenshots, terminal output, network addresses, and
free-form errors. Unknown fields are rejected.

## AC2 — Failure attribution

Pass.

`docs/product/release-scorecard.md` separates activation, provider,
orchestration, execution, quality, recovery, trust, experience, and community
failure. It defines earliest-owner attribution so provider setup failures do not
pollute execution metrics.

## AC3 — Critical release stops

Pass.

The scorecard makes unauthorized cost, credential exposure, unrecoverable data
loss, false completion, permission bypass, sensitive analytics, critical
accessibility failure, and compromised release artifacts unconditional release
stops.

## Verification notes

- Every percentage requires its denominator.
- Owners, cohorts, targets, review windows, and limitations are explicit.
- Initial targets are identified as hypotheses pending external baseline data.
- Canonical state and deterministic evidence define outcomes; model assertions
  are excluded.

