# PIPE-29 evidence

## Outcome

The independent repository is an executable npm monorepo with the application
and package boundaries approved in ADR-001, pinned development dependencies,
one local/CI verification command, and fully offline synthetic adapters.

## Acceptance criteria

- AC1 — PASS: the documented clean setup is `npm ci` then `npm run verify`;
  it succeeds on Node 22 with no provider, connector, container, VPN, remote
  computer, or paid service.
- AC2 — PASS: `.github/workflows/verify.yml` and contributors invoke the exact
  same `npm run verify` gate and lockfile.
- AC3 — PASS: the repository lint scans all product applications, packages,
  scripts, tests, and fixtures for prototype-specific machine/service terms,
  private-address fragments, and likely API keys. The quarantined read-only
  research snapshot is excluded from builds and cannot satisfy workspace paths.

## Delivered

- Four application workspaces: studio, optional desktop shell, core, worker.
- Ten domain packages: orchestration, schemas, storage, policy, providers,
  connectors, tools, validation, evals, UI.
- Strict TypeScript build and reproducible npm lockfile.
- Environment, formatting, isolation-lint, typecheck, build, and test gates.
- Synthetic demo project, fake model provider, and fake issue connector.
- Contributor clean-setup and safe-default guidance.

## Verification result

`npm ci && npm run verify`:

- setup: pass (Node 22.23.1, 15 required entries);
- format: pass;
- isolation lint and secret-pattern check: pass;
- strict typecheck: pass;
- build: pass;
- offline tests: 3 pass, 0 fail.

A second verification is performed from a clean Git export before closure.

## Isolation

No autonomous service, local model, container, provider, connector, or paid API
was started. No Household source, runtime, state, service, or deployment changed.
