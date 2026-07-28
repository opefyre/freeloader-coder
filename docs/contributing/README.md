# Contributor guide

Pipeline Studio is a local-first orchestration product, not a chat wrapper.
Changes must preserve one canonical state model across UI, controller,
providers, validators, reviewers, recovery, and evidence.

## Start a change

1. Complete [local setup](setup.md) and run `npm run setup:check`.
2. Start from a self-contained Jira ticket with acceptance criteria, cited
   contracts, affected surfaces, and observable evidence.
3. Read the relevant architecture decision in
   [architecture](../architecture/system-context.md), the
   [design system](../design/system.md), and the security model.
4. Run focused tests before editing so the baseline is known.

## Contracts that move together

- Schema changes include strict parsing, fixtures, compatibility behavior, and
  a migration or explicit no-migration decision.
- State-machine changes document transitions, leases, idempotency, terminal
  states, recovery budgets, and events.
- Provider adapters implement admission, capabilities, privacy class, quota
  signals, free-only enforcement, circuit behavior, normalized errors, and
  evidence.
- Tool or permission changes update the typed effect, approval class, audit
  record, denial behavior, and safe alternative.
- UI changes use existing tokens, Onest, Phosphor icons, light and dark themes,
  responsive layout, keyboard operation, honest fixture labels, and no
  gradients.

## Prove the change

Run `npm run verify` and `npm run studio:build`. Add focused contract tests,
exercise the visible workflow, and capture meaningful light, dark, and mobile
evidence when the UI changes. Do not mark a ticket complete from a model claim.

The Jira completion comment should identify the commit, files or contracts,
checks, visual evidence, limitations, and follow-up work. Architecture or
security changes are incomplete until their documentation is updated.

## Sample contribution

To add an offline help article, add a strict catalogue entry in
`packages/guidance`, write the matching `docs/...` source, add a contract test
that proves the file exists and links resolve, then verify the `/help` route at
desktop and mobile sizes. If the source is missing or stale, the article must
not present itself as current.

Release rules live in [release gates](../governance/release-gates.md).
