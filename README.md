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

Foundation: product contract, architecture, trust boundaries, durable data,
security, open-source governance, and design-system decisions.

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

Open the URL printed by the start command. Use the Projects screen to inspect
preflight, isolation strength, missing optional dependencies, and Resume or
Repair actions.

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
