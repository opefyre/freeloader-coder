# Privacy, telemetry, data use, and responsible AI

Pipeline Studio is local-first. Canonical project, task, consent, validation,
and recovery state stays on the user’s device unless an explicitly configured
effect needs to send a bounded payload elsewhere.

## Declared data flows

| Flow | Data | Destination | Default | Retention and deletion |
| --- | --- | --- | --- | --- |
| Local operation | Task state, evidence, preferences | This device | On | Until project removal; locally deletable |
| Optional telemetry | Feature event, coarse outcome, error class | Configured endpoint | Off | 30 days when enabled; deletion supported |
| Third-party AI | Redacted prompt, admitted test source, model output | Selected provider | Off globally; explicit project consent required | Provider policy applies |
| Support bundle | Redacted diagnostics, versions, failure classes | Local export until shared | Off | User deletes the local bundle |

Secrets, credentials, health, financial, and personal data are never admitted
to third-party AI by the test-pipeline consent. Source code, Jira task text,
prompts, and model outputs may use training-eligible endpoints only when the
user explicitly authorizes non-personal test data.

## Consent

Consent choices are unbundled and equal in visual weight. A change applies
prospectively and states its exact effect. Disabling optional telemetry stops
future collection and offers deletion where supported. Third-party retention
limitations are shown before routing. Support diagnostics remain local until
the user deliberately shares them.

Paid usage is a separate control and remains disabled. Broader data sharing,
training eligibility, and paid capacity cannot be used as disguised defaults
for one another.

## Responsible AI

- Models propose; deterministic systems own canonical state and verification.
- Prompts are minimized, classified, and redacted before provider routing.
- Consequential tools require permission, bounded effects, receipts, and
  postcondition checks.
- Independent review and evaluations cover quality, privacy, unsafe actions,
  hallucinated completion, injection, and provider failure.
- Provider output is never presented as verified completion by itself.
- Users can inspect the provider, admitted data class, source, and resulting
  evidence for consequential work.

## Current test-pipeline authorization

The current project owner authorized source code, Jira task text, prompts,
model outputs, and other non-personal test data for training-eligible AI
endpoints. Credentials, secrets, health, financial, and personal data remain
local. Paid usage remains disabled.

Owner: Privacy and security maintainers  
Last reviewed: 2026-07-28  
Next review: 2026-10-28
