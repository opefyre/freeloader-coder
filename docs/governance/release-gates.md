# Release gates

All applicable gates are hard gates. A release candidate is not releasable
when evidence is absent, stale, private-only, or contradicted by an unresolved
critical finding.

| Gate | Required evidence | Pass condition | Owner |
| --- | --- | --- | --- |
| User success | First-success funnel and representative session evidence | Supported clean setup reaches verified first success; known gaps are bounded | Product |
| Truth and evidence | Postconditions, deterministic validations, provenance | No queued action or model claim is shown as completed work | Quality |
| Recovery | Interrupted, duplicate, denied, quota, provider-failure fixtures | Work is preserved; retry/rollback/needs-user path is clear and tested | Reliability |
| Free-by-default | Provider quota controls and billing configuration evidence | No paid call can occur without explicit recorded opt-in and hard cap | Product + Platform |
| Security and privacy | Threat/data-flow review, secret scan, permission tests | No critical credential, access, deletion, or data-exposure finding | Security + Privacy |
| Accessibility | Keyboard, screen reader, 200% zoom, contrast, reduced motion | No critical blocker in supported primary and recovery journeys | Accessibility |
| Compatibility | Schema/API/event compatibility and migration tests | Supported upgrades and rollback preserve canonical state | Engineering |
| Documentation | Setup, provider, recovery, limitations, migration guidance | A GitHub-capable builder can act without inventing infrastructure | Documentation |
| Support | Diagnostics bundle and error-to-action mapping | Failures state what happened, what is safe, and recommended alternatives | Support |
| Operations | Health, audit, backup/restore, stop controls | Operators can detect, contain, recover, and explain failure | Operations |

## Release decision

The release record must contain:

- candidate commit and artifact identifiers;
- applicable gates with evidence links and review dates;
- known limitations and supported environments;
- unresolved risks with owners and expiry dates;
- rollout, monitoring, rollback trigger, and rollback procedure;
- explicit `GO`, `NO-GO`, or `CONDITIONAL GO` decision.

`CONDITIONAL GO` is forbidden for a critical security, privacy, paid-use,
data-loss, permission, false-completion, accessibility, or supply-chain
failure. A gate cannot be waived by renaming the failure.

Targets and privacy-safe metric definitions live in
`../product/success-metrics.md`; the release scorecard lives in
`../product/release-scorecard.md`.
