# Pipeline Studio

Pipeline Studio is a local-first autonomous development workspace for
GitHub-capable builders. It turns a request into a grounded, reviewable task
graph; executes work in isolation; validates observable outcomes; and explains
what needs attention when it cannot recover safely.

This repository is independent from the Household application and its private
automation controller. Proven controller code is retained under `_reference/`
only as migration input. Product code must move into an owned package before it
can ship.

## Current phase

Local beta integration: the product contract, architecture, trust boundaries,
durable state, security, governance, and design system are implemented. Project
registration, request planning, isolated changes, free-provider connections,
proposal generation, and the main operations dashboard now use the local
control plane. Remaining feature screens that are simulations identify
themselves explicitly.

## Clone and run

Requirements: Git, Node.js 22 or newer, npm 10 or newer, 8 GB memory, and
5 GB free disk. Docker, a local model runtime, cloud accounts, and provider keys are optional.

```sh
git clone https://github.com/opefyre/freeloader-coder.git pipeline-studio
cd pipeline-studio
npm ci
npm run setup
npm start
```

Setup checks the computer, chooses a loopback-only port, and creates private
ignored runtime state. It does not store credentials in the repository. Repeat
`npm run setup` safely after fixing a requirement, or run `npm run repair` to
reconcile routine local-runtime issues without deleting projects or secrets.

`npm start` builds the workspace, starts the read-only local control plane on
`127.0.0.1:4312`, and starts Studio on `127.0.0.1:4310`. Open the Studio URL
printed by the command. Stopping the command stops both processes. If either
process cannot start, its peer is stopped too so a partial runtime is not left
behind.

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

Pipeline Studio is available under the [Apache License 2.0](LICENSE). Public
contributions use DCO terms and must follow the
[contributor guide](docs/contributing/README.md), the
[community code of conduct](CODE_OF_CONDUCT.md), and the
[private vulnerability process](docs/support/reporting.md).

The local `/launch` route explains the evidence-backed product promise,
adjacent-product boundaries, safe failure/recovery behavior, release gates,
support coverage, and privacy-safe learning scorecard. It creates no public
deployment, campaign, analytics transmission, or provider request.

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
