# Open-source adoption policy

Pipeline Studio is licensed under Apache License 2.0. The choice is permissive,
allows commercial and private use, and includes an explicit patent grant.
This document explains project policy; the `LICENSE` file is authoritative.

## Dependency policy

- Commit the npm lockfile and use exact dependency versions.
- Treat install scripts, downloaded binaries, and network access as declared
  effects.
- Record purpose, source, license, transitive impact, vulnerabilities, and
  removal path for every new runtime dependency.
- Allow permissive licenses such as Apache-2.0, MIT, BSD-2-Clause,
  BSD-3-Clause, and ISC after verification.
- Require explicit maintainer and compatibility review for MPL-2.0 or LGPL.
- Deny AGPL, SSPL, BUSL, Commons Clause, unknown, or missing licenses unless a
  public decision record explicitly changes this policy.
- A lockfile mismatch, critical unresolved vulnerability, denied license,
  unexpected package, or credential blocks release.

## Contribution terms

Contributions use Developer Certificate of Origin terms rather than a separate
CLA. By submitting a contribution, the contributor certifies they have the
right to submit it under the repository license. A commit sign-off is required
for public contributions:

```text
Signed-off-by: Contributor Name <contributor@example.com>
```

Contributors must follow `docs/contributing/README.md`,
`CODE_OF_CONDUCT.md`, and the private vulnerability process in
`docs/support/reporting.md`.

## Product name and marks

“Pipeline Studio” and the project logo identify this repository. Nominative use
such as “compatible with Pipeline Studio” is allowed. Modified distributions
must not imply endorsement or present themselves as the official build.
Use of the name or logo in a product, service, domain, or commercial identity
requires written permission from the project owner.

## Review record

- Decision: Apache-2.0 with DCO contribution terms.
- Owner: repository owner.
- Effective: 2026-07-29.
- Review by: 2026-10-29 or before adding a foundation, company, delegated
  maintainers, or dual-license offer.
- Legal limitation: this project policy is not legal advice.

