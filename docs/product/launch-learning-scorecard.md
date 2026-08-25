# Launch learning scorecard

This is the required review contract, not a claim that public launch data
already exists.

| Outcome | Baseline | Target | Owner | Cohort | Source | Cadence |
| --- | ---: | ---: | --- | --- | --- | --- |
| Clone to validated preview | Local beta: 12 min | Under 15 min | Product owner | New local installs | Local event | Weekly |
| Preview accepted or deliberately restored | Local beta: 88% | At least 85% | Product owner | First projects | Local event | Weekly |
| Interrupted work recovered without loss | Synthetic: 94% | At least 90% | Reliability owner | Interrupted runs | Local event | Release |
| Unauthorized paid calls | 0 | 0 | Security owner | All runs | Local event | Release |
| Support reports with a safe reproduction | Synthetic: 81% | At least 75% | Support owner | Public issues | Support | Weekly |
| Users confident enough to continue | Not established | At least 70% | Research owner | Opt-in interviews | Interview | Monthly |

Metrics must never include prompts, source code, attachments, credentials,
absolute paths, personal identifiers, or private Jira content. Optional
telemetry requires consent and must preserve an entirely local path.

## Review decision

The current decision is **continue the local beta**. Public release evidence is
insufficient until the product name/positioning and open-source terms are
confirmed in the public repository and the public experience is deployed and
tested.

Every “change” or “retire” decision must create an owned experiment with a
hypothesis, success signal, review date, and rollback. “Keep” still requires a
future review date.

## First public evidence window — 2026-08-25

The canonical Cloudflare Pages release and every public source, security, and
feedback link passed external checks. GitHub's privacy-safe 14-day aggregates
reported 16 views from 1 unique visitor and 136 clones from 69 unique cloners.
Those figures include operator and automation activity and therefore do **not**
prove activation, retention, or adoption.

Decision: **insufficient evidence**. The owned next experiment is one consented
external owner journey, due for review on 2026-09-01. Success requires reaching
`review_ready` while recording only time-to-preview and structured trust
feedback—never prompts, source code, attachments, credentials, full paths, or
personal identifiers. The schema-validated review is stored in
`docs/evidence/PIPE-112-LAUNCH-LEARNING-2026-08-25.json`.

## Local contract certification — 2026-08-25

The zero-cost synthetic certification passed all eleven required stages for the
owner MVP, new-product, and existing-product journeys. It recorded zero paid
calls and zero external effects. The schema-validated receipt is
`docs/evidence/PIPE-622-OWNER-JOURNEY-CERTIFICATION.json`.

This does not satisfy the external-owner experiment. It proves that the local
contract can reach durable completion without exposing project material; live
provider availability, human comprehension, time-to-preview, and trust still
require the consented journey scheduled above.

Codkesh now exposes this distinction in Action Center. The local certification
can be run and inspected there, while the separately consented learning flow
records only an opaque project identifier, scenario class, ordered milestone
timestamps, structured trust/friction feedback, and a digest. Active,
completed, and withdrawn states remain local and survive restart. Withdrawal
clears the note and feedback. Synthetic certification cannot be promoted into
external evidence, and a single completed session cannot be described as
adoption, retention, or market validation.

## Automatic trust freshness and pilot-readiness policy

Local certification is evaluated on startup and hourly, with a seven-day
freshness window. Only one due run can be active. A failed automatic run keeps
the last passing evidence and waits six hours before retrying, preventing
continuous quota or compute pressure. Every automatic path has a literal $0
spend limit and no external effect.

Pilot learning becomes decision-eligible only after three completed consented
sessions. The aggregate includes completion rate, median time-to-preview,
average trust, the share of ratings at four or five, and bounded friction
counts. It excludes participant aliases, notes, drafts, and withdrawn sessions.
The initial review thresholds are 70% completion, a median preview time of at
most 30 minutes, and at least 67% of ratings at four or five. Passing these
thresholds means “ready for owner review,” not adoption, product-market fit, or
public-launch approval.

The evidence review is deterministic and aggregate-only. It ranks bounded
friction categories and creates an improvement candidate only when the same
category appears in at least two completed sessions. Each candidate carries an
evidence count, digest, priority, size, recommendation, and acceptance
criteria. Raw notes, project content, participant identity, credentials, and
attachments are never included in the review or a future Jira handoff.
