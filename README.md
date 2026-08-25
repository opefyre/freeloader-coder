# Codkesh

Codkesh is one local-first autonomous product-development app for
GitHub-capable builders. Its single interface combines project intake,
integrations, action and progress views, and a complete coding canvas. It turns
a request into grounded, reviewable work; executes in isolation; validates
observable outcomes; and explains what needs attention when it cannot recover
safely.

This repository is independent from the Household application and its private
automation controller. Proven controller code is retained under `_reference/`
only as migration input. Product code must move into an owned package before it
can ship.

## Current phase

Unified local beta: Codkesh owns the public UI, settings, integrations,
project activity, model routing, and launch lifecycle. The embedded coding
engine is an internal component and is not a second product or a second user
entry point. Generated runtime state remains private and ignored.

## Clone and run

Requirements: Git, Node.js 22 or newer, npm 10 or newer, 8 GB memory, and
5 GB free disk. Docker, a local model runtime, cloud accounts, and provider keys are optional.

```sh
git clone https://github.com/opefyre/freeloader-coder.git codkesh
cd codkesh
npm ci
npm run setup
npm start
```

Setup checks the computer, installs the embedded coding canvas when needed,
chooses a loopback-only port, and creates private ignored runtime state. It does
not store credentials in the repository. Repeat `npm run setup` safely after
fixing a requirement, or run `npm run repair` to reconcile routine local-runtime
issues without deleting projects or secrets.

`npm start` launches the complete app at `127.0.0.1:4310`. Internal loopback
services are implementation details and should not be opened directly. Stopping
the command stops the whole local stack. If any required service cannot start,
the launcher stops its peers so a partial runtime is not left behind.

Use `PIPELINE_STUDIO_STUDIO_PORT` and `PIPELINE_STUDIO_CONTROL_PORT` to choose
different loopback ports:

```sh
PIPELINE_STUDIO_STUDIO_PORT=4390 \
PIPELINE_STUDIO_CONTROL_PORT=4392 \
npm start
```

Use the Projects screen to inspect preflight, isolation strength, missing
optional dependencies, and Resume or Repair actions. The global runtime
indicator distinguishes a live, stale, or offline local control plane. Feature
screens that are not connected yet still use clearly labelled synthetic
fixtures; a live runtime indicator does not imply that every connector or
external action is enabled.

The Overview route is live when the control plane is available. It aggregates
registered projects, durable local requests, request stages, restart-safe
events, and configured free-provider readiness. It shows explicit loading,
offline, stale, empty, idle, and attention states and never substitutes demo
metrics for missing runtime data. The response remains loopback-only,
schema-validated, bounded, privacy-redacted, and fixed at a zero-dollar
automatic spend limit.

The Work route is also live. Its local safe-step coordinator derives one
revision-bound next action per durable request, persists project modes, pauses,
leases, schedules, and receipts in private local state, and advances only
actions already permitted by existing authority. Guided mode is the default.
Broader modes require confirmation and still stop before request, plan,
execution, proposal, change, commit, and integration approvals. Provider waits
use observed retry times instead of constant retries, and automatic spend is
structurally fixed at zero.

The Activity route is a live, bounded operational history. It combines
canonical request and run events with project observations, provider state,
coordinator recommendations, leases, and receipts. Filters and search are
validated by the loopback API; the Studio preserves stale observations without
inventing progress. Local JSON exports contain only the displayed redacted
records and explicitly exclude credentials, personal paths, prompts, source
content, and provider response bodies.

The Decisions route turns canonical blockers and authority boundaries into one
prioritized local inbox. It combines required input, approvals, validation
failures, interrupted work, provider waits, project warnings, expired leases,
and coordinator recommendations without broadening execution authority.
Priority, aging, ownership, cost, reversibility, evidence, and the safe next
surface are deterministic and inspectable. The inbox is read-only, privacy
redacted, bounded to current observations, and keeps automatic spend at zero.

The Attention route adds durable attention management without changing task
state. It derives stable alerts from canonical decisions and verified
completions, redacts sensitive detail, deduplicates repeated observations, and
persists read, acknowledgement, snooze, quiet-hours, and idempotency receipts
in private local state. The global bell shows only the exact unsuppressed
unread count. Critical alerts bypass quiet hours; all actions are previewed,
revision-bound, local-only, reversible, and fixed at zero automatic spend.

The global command center is a live, keyboard-first search surface opened from
the header or with Command-K / Control-K. It deterministically ranks safe
workspace destinations and bounded current request, decision, attention, activity,
project, and provider observations. Results expose provenance and navigate only
to validated internal routes; search cannot mutate work, call a model, write to
an external service, or enable paid use.

Projects can now register an existing local Git worktree through the loopback
control plane. Registration performs a deterministic, bounded metadata scan and
stores the canonical path only in the private ignored local state directory.
The browser receives an opaque project ID, display name, observed facts,
bounded inferences, decisions, and explicit limitations—never the absolute
path, source content, secrets, or credential values. Rescan remains read-only,
and **Forget registration** removes only Studio metadata; it never deletes or
changes repository files.

Working-tree cleanliness is intentionally reported as not evaluated in this
phase because the scanner does not execute Git or repository commands.
GitHub clone onboarding and the later preview/execution journey remain clearly
labelled synthetic examples.

For UI-only development, `npm run studio:dev` starts Vite without the control
plane. Studio will correctly show the runtime as offline while preserving the
last safe observation and synthetic feature data.

The standalone public-site foundation runs separately on `127.0.0.1:4311`:

```sh
npm run site:dev
```

It uses a dedicated build output and does not require the local control plane,
credentials, provider access, analytics, or external writes. Run
`npm run site:release-check` to build it and enforce its content and bundle
budgets. The verified public preview is available at
[pipeline-studio.pages.dev](https://pipeline-studio.pages.dev/). Real adoption
measurement remains intentionally separate work; a deployment alone is not
treated as evidence of product adoption.

The offline [user guides](docs/guides/README.md) explain the first project,
provider connections, approvals, evidence, recovery, and publishing. The
in-product Help Center is available at `/help`. Contributors should start with
[CONTRIBUTING.md](CONTRIBUTING.md), and security reports must use the private
process in [SECURITY.md](SECURITY.md).

The local [Release Center](docs/architecture/release-lifecycle.md) at
`/releases` previews reproducible artifacts, compatibility, preservation-first
updates, rollout gates, incidents, and rollback. It does not enable CI/CD or
deployment automation.

The local [Trust Center](docs/governance/README.md) at `/trust` connects
governance decisions, supply-chain gates, privacy choices, data journeys, and
responsible-AI rules to their versioned sources. It makes no legal approval
claim and performs no external action.

The local [Accessibility Center](docs/quality/accessibility-release-gate.md) at
`/accessibility` makes WCAG 2.2 AA evidence release-blocking and links
foundation claims to reproducible tests, negative fixtures, and named manual
review.

The [executable release registry](docs/evidence/PIPE-125-171-EXECUTABLE-PROOF.md)
under **Evidence → Release registry** maps onboarding, policy, provider,
execution, packaging, and update claims to current proof and safe negative
fixtures.

Optional OpenAI API, Anthropic API, and Codex integrations are documented in
the [paid-provider architecture](docs/architecture/optional-paid-providers.md).
They ship disabled and cannot execute without a later explicit credential,
route, role, hard budget, and final approval.

Codkesh is available under the [Apache License 2.0](LICENSE). Public
contributions use DCO terms and must follow the
[contributor guide](docs/contributing/README.md), the
[community code of conduct](CODE_OF_CONDUCT.md), and the
[private vulnerability process](docs/support/reporting.md).

The local `/launch` route explains the evidence-backed product promise,
adjacent-product boundaries, safe failure/recovery behavior, release gates,
support coverage, and privacy-safe learning scorecard. It creates no public
deployment, campaign, analytics transmission, or provider request.

## Local certification

Run `npm run certify:owner-journey` to exercise the complete zero-cost synthetic
owner journey for both a new and an existing project. The command fails if
intake, governed artifacts, approval, Jira-backed planning, isolated delivery,
validation, independent review, integration, or durable completion is missing.
It writes a schema-validated receipt containing only stage names, digests,
timing, and explicit limitations; prompts, source code, attachments,
credentials, absolute paths, personal identifiers, and private Jira content are
excluded. This certification proves the local product contract, not external
adoption or live provider availability.

The same check is available in **Action Center → Owner-journey check**. It
shows the eleven bounded stages, keeps the last passing receipt when a later
run fails, and never adds another primary navigation page. Action Center also
supports a consented external-owner learning record. That record uses an
anonymous generated alias and structured timing/trust fields; it excludes
prompts, project files, names, email, credentials, attachments, private Jira
content, and provider output. A draft can be completed or withdrawn locally.
One session is learning evidence, never an adoption claim.

`npm run artifacts:identity:preview` shows a mutation-free governed-artifact
identity plan. `npm run artifacts:identity:apply` applies the same explicit
replacement through digest-bound writes with history preservation. Changed
owner-approved artifacts become pending again instead of inheriting stale
approval.

## Non-negotiable product promises

- Local-first canonical state and recoverable work.
- No paid model usage unless the user explicitly enables a budget.
- No claim of completion without deterministic postcondition evidence.
- Secrets remain outside source control, prompts, logs, analytics, and support
  bundles.
- Standard mode explains decisions in familiar Git and build language.
- Advanced mode exposes deeper evidence without creating a second state model.

## Work tracking

Implementation is tracked in the
[PIPE Jira project](https://opefyre.atlassian.net/jira/software/projects/PIPE/backlog).

## Documentation

The
[PIPE Confluence documentation hub](https://opefyre.atlassian.net/wiki/spaces/PI/pages/27951631/Pipeline+Studio+Documentation+Hub)
is the system of record for durable product, architecture, governance,
operations, research, and delivery-evidence documentation. Jira remains the
work record, and completion comments must link the relevant Confluence page.

Repository entry documents and code-adjacent material required by GitHub,
builds, releases, security, or open-source workflows remain in Git. Existing
files under `docs/` are historical migration mirrors; do not add new sprint
evidence or general product documentation there.
