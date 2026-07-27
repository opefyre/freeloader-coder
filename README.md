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

