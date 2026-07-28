# PIPE-51 — Free-only defaults and paid-use safeguards

Status: verified locally on 2026-07-28.

## Outcome

Pipeline Studio now treats cost as an enforceable routing policy instead of a
preference. Every default policy is `free_only`; unknown-cost routes,
billing-enabled provider projects, retired routes, and paid routes are rejected
before a provider call can be created.

Paid execution cannot be enabled by a boolean or by connecting a provider. It
requires one unexpired, unrevoked authorization matching the exact provider
connection, provider, model, and project. The authorization separately records
connection approval, route approval, a hard spend ceiling, observed spend,
currency, expiry, and a final confirmation digest bound to the request.

## Acceptance-criteria evidence

### AC1 — No paid request from default configuration

- `tests/cost-policy.test.ts`
  - `every default cost policy is free-only and cannot produce a paid route`
  - `a boolean cannot enable paid use without exact connection, route, budget,
    and confirmation`
  - `exact paid authorization is time bounded and hard-budgeted`
- `tests/provider-routing-parity.test.ts`
  - `paid providers and external sensitive-data routes remain ineligible`
- The router rejects contradictory paid/free model declarations and refuses a
  paid model without connection, project, and cost bounds.

### AC2 — Truthful exhaustion, rate-limit, and retirement alternatives

- `tests/provider-routing-parity.test.ts`
  - `router falls back around circuits and provider-reported exhaustion`
  - `retired routes are never selected and name configured alternatives`
- `tests/provider-runtime.e2e.test.ts`
  - `all-free exhaustion defers until reset without calling or poisoning the
    task`
- The Studio provider mesh distinguishes successful execution evidence from
  configuration, presents reset/cooldown details, and shows a retired route with
  named alternatives.

### AC3 — Automated denial-of-wallet release gate

- `tests/cost-policy.test.ts`
  - rejects unknown-cost models;
  - rejects billing-enabled Gemini projects in free-only mode;
  - rejects missing, mismatched, expired, revoked, unconfirmed, and
    over-budget paid authorizations;
  - rejects unknown schema fields, invalid confirmation digests, and recorded
    overspend.
- `tests/studio-workspace-contract.test.ts`
  - `workspace exposes an interactive denial-of-wallet proof instead of a cost
    promise`
- `npm run verify` runs setup, format, lint, typecheck, fresh compilation, and
  the entire test suite. Any denial-of-wallet failure blocks the release gate.

## Verification result

- Setup check: passed
- Format check: passed
- Lint: passed
- Typecheck: passed
- Fresh build: passed
- Automated tests: 77 passed, 0 failed
- Desktop browser QA: cost-lock proof rendered; safeguard disclosure expanded;
  provider retirement and free-capacity explanations were inspectable
- Responsive contract QA: the cost-lock has explicit one-column tablet/mobile
  reflow and is covered by the workspace responsive-contract test

No credentials, provider prompts, private source, or paid service were used for
this verification.
