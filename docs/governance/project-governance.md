# Project governance

Pipeline Studio uses transparent, repository-backed governance. These rules
describe the process; they do not claim that a particular person currently
holds a role.

## Roles and continuity

| Role | Core authority | Selection | Continuity |
| --- | --- | --- | --- |
| Maintainer | Triage the roadmap and merge verified work | Public nomination and active-maintainer consensus | Release owner may contain urgent release risk |
| Release owner | Accept or reject one release evidence package | Named in the release record | Maintainer may pause or roll back |
| Security steward | Privately triage vulnerabilities and coordinate disclosure | Documented maintainer consensus | Maintainer uses the security-emergency procedure |

Every active holder, handoff, and conflict disclosure must be recorded publicly
unless publication would expose a security report or personal information. No
undocumented individual account may be the only way to build, verify, or
release the project.

## Decisions

Material product, architecture, privacy, security, provider, compatibility, and
release-gate changes require a versioned decision record. Records move through
Draft, Proposed, Accepted or Rejected, and optionally Superseded. Model output
may propose a record but cannot approve it.

Accepted records link to affected Jira work, commits, evidence, and releases.
Corrections are appended; accepted history is never silently rewritten.

## Roadmap and issue triage

1. New work states the user outcome, evidence, dependencies, risk, and safe
   failure behavior.
2. Maintainers classify bugs, security reports, support requests, proposals,
   and provider changes.
3. Highest priority goes to credential exposure, data loss, paid-use leakage,
   false completion, broken recovery, and accessibility blockers.
4. A public sprint goal names the bounded outcome. Items cannot be marked Done
   until observable evidence is linked.
5. Roadmap movement is explained in the issue or decision record.

## Moderation and conduct

Project spaces follow [the Code of Conduct](../../CODE_OF_CONDUCT.md).
Moderation actions must be proportional, privacy-preserving, and documented to
the affected participant when safe. Appeals are reviewed by a maintainer who
did not make the original decision. Security reports and personal details are
never debated in public issues.

## Official and community adapters

An official adapter is owned in this repository, has a named support level,
permission and privacy documentation, compatibility evidence, failure
fixtures, and a maintainer-approved release path. Community adapters are
welcome but must identify their independent owner and cannot imply official
support.

## Inactive maintainer

After 30 days without response on a documented release, security, or continuity
request, another active maintainer may open a succession proposal. After a
further 14-day public review, active maintainers may transfer the minimum
required ownership. Credentials are rotated and the handoff is recorded.

## Security emergency

The security steward or fallback maintainer may pause an affected release,
provider, connector, or update immediately. They must preserve evidence,
minimize disclosure, rotate affected credentials, ship a bounded verified fix,
and publish a retrospective when disclosure is safe. Emergency authority
cannot enable paid usage or waive a failed critical gate.

## Disclosures

Funding, sponsorship, employment conflicts, and material vendor relationships
are recorded in [disclosures.md](disclosures.md). “None declared” is an explicit
state, not missing information.

Owner: Maintainers  
Last reviewed: 2026-07-28  
Next review: 2026-10-28
