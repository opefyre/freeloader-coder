# Launch and community playbook

The public launch stays paused until every required release, license, security,
accessibility, support, and rollback gate has current evidence. A local preview
or drafted message is not a launch.

## Channels

| Channel | Purpose | Entry condition | Rollback |
| --- | --- | --- | --- |
| GitHub repository | Source, releases, issues, discussions | License, community files, release evidence | Archive release, pin incident, pause intake |
| Product page | Explain outcome and safe demo | Claims sourced and accessibility verified | Replace with maintenance notice |
| Technical communities | Reach relevant builders | Support capacity and honest limitations ready | Stop posting; update original thread |
| Direct design partners | Learn from complete journeys | Consent and interview plan ready | End recruitment and delete contact list |

No channel is automatically posted by Pipeline Studio.

## Support coverage

- One launch owner and one explicitly named backup are required.
- Triage at least twice per working day during the first launch week.
- Use dedicated installation, provider, bug, feature, and documentation issue
  templates.
- Security reports use private GitHub advisories.
- Publish known limitations and provider incidents without hiding failures.
- Stop new promotion when untriaged critical reports exceed capacity.

## Incident levels

- **SEV-1:** credential exposure, data loss, unauthorized paid use, or a false
  completion that can cause material harm. Pause launch immediately.
- **SEV-2:** widespread installation, provider, validation, or recovery failure.
  Pause affected claims and channels.
- **SEV-3:** bounded defect with a safe workaround. Document, prioritize, and
  keep monitoring.

Every incident records owner, impact, start time, affected versions, current
evidence, containment, recovery, user communication, and follow-up. Never put
credentials or private source in the incident record.

## Stop conditions

Pause promotion when a release-blocking gate fails, support capacity is
exhausted, the public experience contradicts the repository, or a core claim
lacks evidence. Recovery requires a current postcondition, not a maintainer or
model assertion.

