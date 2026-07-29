# PIPE-197–202: live local control-plane proof

## Outcome

Pipeline Studio now has its first real browser-to-runtime observation path.
`npm start` supervises the compiled local control plane and Studio together.
The browser polls a versioned, read-only loopback API and exposes honest
connecting, live, stale, and offline states without replacing synthetic feature
fixtures with invented runtime data.

## Delivered contract

- `GET /api/v1/health` returns a validated service-health contract.
- `GET /api/v1/snapshot` returns validated local observation, setup summary,
  service checks, instance identity, and explicit feature-data provenance.
- Runtime contracts reject duplicate services, invalid readiness counts, and
  malformed timestamps.
- The browser preserves its last valid snapshot through transient failures and
  can recover to live without a page reload.
- A live HTTP response is not labelled healthy unless the setup observation and
  control-plane service check are also ready.

## Trust boundary

- The server binds only to `127.0.0.1` or `::1`.
- Only configured loopback browser origins receive CORS access.
- Unknown routes, request bodies, unsafe methods, non-loopback hosts, and
  unapproved origins are rejected.
- Responses are no-store, bounded, schema-validated, and carry restrictive
  browser security headers.
- The endpoint exposes no credentials, secret values, repository paths,
  provider prompts, or personal data.
- The control plane is observation-only. It cannot run a task, connect a
  provider, approve work, publish, deploy, or spend money.
- Feature screens remain synthetic fixtures and are labelled as such even while
  the runtime itself is live.

## Supervision proof

- `npm start` builds before launching.
- Studio and the control plane receive matching, configurable loopback ports and
  an exact allowed origin.
- Failure to start either peer terminates the other.
- SIGINT and SIGTERM stop both process groups with a bounded forced-shutdown
  fallback.
- Manual proof used alternate ports `4390` and `4392`; both services started,
  served successfully, and exited cleanly after Ctrl+C with no remaining
  listener.

## Automated evidence

The sprint added contract, server, client-state, launcher, and release-hardening
tests. The full offline test suite passed with **460/460 tests**.

Covered negative cases include:

- invalid contract data and duplicate service identifiers;
- non-loopback bind addresses;
- rejected origins, hosts, methods, bodies, and unknown routes;
- malformed and oversized browser responses;
- timeout/network failure, stale observations, recovery, and snapshot
  preservation;
- launcher port validation, build-first ordering, peer supervision, and
  shutdown behavior.

`npm run studio:release-check` passed the production build and bundle budgets:

- entry: 394,350 / 450,000 bytes;
- shared React runtime: 189,644 / 210,000 bytes;
- largest feature chunk: 58,032 / 75,000 bytes.

## Browser evidence

The production UI was exercised against a real local control-plane process.
The global indicator moved from **Local runtime** to **Runtime offline** when the
process stopped, then returned to **Local runtime** after restart without a page
reload. The disclosure preserved the last observation and continued to identify
all feature data as demo data.

A `390 × 844` dark-theme smoke check passed with no horizontal overflow
(`scrollWidth = innerWidth = 390`) and no browser-console errors.

## Scope

This increment intentionally does not implement task execution, provider calls,
credentials, paid usage, external integrations, deployment, or live feature
datasets. Those capabilities require separate contracts, authorization, and
evidence gates.
