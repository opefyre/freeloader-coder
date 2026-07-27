# ADR-001: Local-first modular core with isolated execution workers

- Status: Accepted
- Date: 2026-07-27
- Owner: Core Platform
- Approver: Project owner
- Jira: PIPE-28, parent PIPE-2
- Affected packages/services: UI, local API, orchestration, storage, policy,
  providers, connectors, tools, workers, validators
- Supersedes: none
- Superseded by: none

## Context and invariants

Pipeline Studio must turn a proven private two-computer prototype into a
portable product a GitHub-capable builder can clone and run on one computer.
The user may optionally add remote workers or external providers later. Those
choices cannot be required for setup, canonical state, review, recovery,
export, or deletion.

The architecture must preserve:

- one authoritative task and evidence state across restarts;
- observable postconditions rather than model claims;
- free-by-default provider routing with paid use disabled;
- local credential custody and explicit external-data policy;
- crash isolation for untrusted commands and model-driven actions;
- a useful offline path with fake/local providers;
- Standard and Advanced views over the same records.

## Options considered

### A. In-process modular monolith

One runtime owns UI serving, API, orchestration, provider calls, tools,
validation, and storage.

Benefits: simplest install and debugging; lowest idle resource use.

Rejected as the complete design because untrusted commands, runaway validators,
and connector failures share the control plane's memory and lifecycle. A crash
can make recovery state unavailable at the moment it is needed.

### B. Fine-grained microservices

Every domain runs as a separately deployed service with network APIs and its
own lifecycle.

Rejected for the first release. It creates ports, credentials, service
discovery, distributed failure, and operational work that the target user
should not have to understand. It also makes a second machine or container
platform feel foundational.

### C. Modular local core plus supervised execution processes

A single local control-plane process owns canonical state, API, orchestration,
policy, provider routing, connector coordination, and static UI delivery.
Commands, validators, and high-risk adapters run in bounded child processes or
containers behind typed interfaces. Optional remote workers implement the same
interface.

Selected. It gives a one-command, one-computer default while isolating the
least trusted and most failure-prone execution.

## Decision

### Repository and module boundaries

Use one versioned monorepo. Deployable applications and reusable packages are
separate workspaces:

- `apps/studio`: browser UI, built to static assets for production;
- `apps/core`: authenticated loopback API, supervisor, and lifecycle owner;
- `apps/worker`: local or optional remote execution worker;
- `packages/orchestration`: task graph, leases, retries, recovery, reviews;
- `packages/schemas`: versioned commands, events, state, artifacts, errors;
- `packages/storage`: event journal, projections, migrations, backups;
- `packages/policy`: permissions, privacy classes, cost and effect gates;
- `packages/providers`: model-provider interface and adapters;
- `packages/connectors`: Jira, GitHub, and future external-system adapters;
- `packages/tools`: declared model-callable actions and sandbox contracts;
- `packages/validation`: deterministic validation and evidence;
- `packages/evals`: model, privacy, routing, and workflow evaluations;
- `packages/ui`: design system and accessible shared components.

Workspace boundaries are code ownership boundaries, not network boundaries.
Direct cross-package imports must follow the declared dependency graph.

### Process ownership and lifecycle

`apps/core` is the only required long-lived process. It:

1. obtains a single-instance lock scoped to the selected workspace;
2. opens and migrates the canonical store;
3. reconciles expired work and interrupted effects;
4. starts the authenticated loopback API and serves built UI assets;
5. supervises bounded worker processes;
6. drains active work on shutdown and records interruption evidence.

Workers never own canonical task state. They receive versioned work envelopes,
emit versioned events/artifacts, and can be killed without losing the
authoritative recovery path. Each execution has CPU/time/output limits,
workspace scope, allowed tools, environment allowlist, cancellation, and a
unique idempotency key. Containers are supported where available but are not
required for read-only or low-risk local operations.

Crash behavior:

- UI crash: core and work continue; reconnect resumes from event cursor.
- worker crash: lease expires or supervisor records failure; policy chooses
  bounded retry, alternative provider, quarantine, or needs-user.
- core crash: durable journal remains authoritative; startup reconciliation
  never assumes an attempted effect completed.
- storage failure: mutations stop; read-only diagnostics and backup guidance
  remain available where safe.

### Canonical state and storage

The default store is local SQLite in WAL mode with migrations, foreign keys,
integrity checks, encrypted secret references, and an append-only domain event
journal. Materialized tables are rebuildable projections. Artifact files are
content-addressed and referenced by digest.

The database, not Jira, GitHub, a model, a worker, or the UI, is authoritative
for orchestration state. External systems are reconciled projections with
idempotent effect records and observable postconditions.

### Local protocol

The production core listens only on `127.0.0.1` and `::1` using an
operating-system-assigned port. It refuses wildcard or LAN binding unless an
Advanced, separately approved remote-access adapter is configured.

Browser bootstrap:

1. core generates a single-use, short-expiry nonce stored in a user-only file;
2. it launches a loopback URL containing the nonce in the fragment;
3. the UI exchanges it once for an `HttpOnly`, `SameSite=Strict` session;
4. origin checks, CSRF protection, expiry, rotation, and logout apply.

The API uses versioned JSON over HTTP for queries and idempotent commands.
Server-Sent Events provide an ordered, resumable event stream using event IDs
and cursors. Large artifacts are fetched separately after authorization and
digest verification. Unknown schema versions and fields are rejected according
to the compatibility policy; they are never guessed.

Child workers use length-bounded NDJSON over inherited stdio. No local worker
port is required. A worker receives capabilities, not ambient access.

### Trust boundaries

1. **Browser ↔ core:** authenticated loopback session, strict origins, CSRF,
   input validation, no secret values returned.
2. **Core ↔ local worker:** typed envelopes, least-capability grants, bounded
   execution, redacted environment, workspace path validation.
3. **Core ↔ external provider:** outbound TLS, provider/privacy classification,
   explicit prompt-data eligibility, quota and cost circuit, secret redaction.
4. **Core ↔ connector:** minimum scopes, effect preview/approval policy,
   idempotency, audit record, postcondition, compensation where possible.
5. **Workspace ↔ Pipeline Studio state:** project source remains distinct from
   application state, secrets, artifacts, and temporary worktrees.

Credentials remain in an OS credential store through an injected secret-store
adapter. Development may use an explicitly ignored local file, never defaults
or committed fixtures.

### Optional distribution

Remote workers implement the worker protocol through an optional authenticated
transport with mutually authenticated identities, capability grants, heartbeat,
lease, cancellation, and artifact integrity. Removing the remote adapter
returns the product to local execution without state migration.

An OAuth broker is optional. Providers/connectors may instead use API keys,
device authorization, or a local loopback OAuth callback. The broker never
becomes the canonical credential store or a dependency for local startup.

### External calls

The core can call an external model, connector, package registry, or update
service only when:

- the adapter is enabled;
- credentials and scopes are valid;
- data classification permits the payload;
- cost policy permits the call (paid disabled by default);
- quota/circuit policy permits an attempt;
- request and result produce a redacted audit event.

Canonical validation, recovery, export, deletion, and UI access do not depend
on an external service.

## Consequences and risks

Benefits:

- one-computer default with no Docker, cloud account, Tailscale, or daemon
  fleet required;
- better containment than an all-in-process application;
- a clean upgrade path to remote compute without a second state system;
- shared schemas prevent UI/worker/provider meanings from drifting.

Costs:

- supervisor and IPC logic are required;
- SQLite remains a deliberate single-writer constraint;
- sandbox strength varies by operating system;
- remote workers require a separate threat model before release.

The core must not become an unstructured monolith. Dependency rules, contract
tests, and package ownership enforce modularity.

## Migration from the Household prototype

The snapshot under `_reference/household-pipeline` is read-only research input,
not application source.

Migration stages:

1. inventory behavior and classify retain, redesign, or reject;
2. define schemas and golden parity fixtures before copying implementation;
3. extract pure orchestration, routing, quota, circuit, grounding, review,
   validation, and healing logic behind new interfaces;
4. replace machine paths, LaunchAgents, Tailscale addresses, account names,
   provider/model assumptions, and Jira coupling with injected adapters;
5. run old/new parity fixtures plus single-machine interruption/recovery tests;
6. keep the independent repository rollback point until the generalized path
   passes the release gates.

No change is made in place to the running Household controller. Deliberate
behavior differences require their own accepted decision and migration note.

## Verification and observability

PIPE-29 will prove reproducible repository setup. PIPE-30 will provide
executable schema, replay, and error-contract tests. PIPE-31 will provide parity
and single-machine migration evidence.

Required architectural checks include:

- core refuses non-loopback binding by default;
- UI access fails without nonce/session and after expiry;
- worker crash does not corrupt canonical state;
- event resume reconstructs the same projection;
- disabling all remote/OAuth adapters preserves the primary journey;
- paid provider attempts are denied without explicit recorded opt-in.

Health reporting separates core, store, worker, provider, connector, quota,
validation, and recovery state without exposing secrets or project content.

## Rollout and rollback

Land schemas and fake adapters first, then the core, local worker, UI, and
optional adapters. Each migration is reversible while its prior schema remains
supported. On failed rollout, stop new claims, drain or expire leases, retain
the journal/artifacts, restore the last compatible binary and database backup,
rebuild projections, and verify integrity before resuming.

## Replacement triggers

Supersede this ADR if evidence shows any of the following:

- supported workloads cannot meet reliability or latency goals under SQLite's
  single-writer model;
- isolation requirements cannot be met with supervised local workers;
- a supported primary journey genuinely requires multi-host availability;
- loopback browser delivery cannot meet platform security requirements;
- monorepo coupling prevents independent compatibility or release guarantees.

Replacement must retain a one-computer path or be approved as a material
product change, with migration, compatibility, cost, and rollback evidence.

## Approval

Accepted for the Foundation phase under the product contract completed by
PIPE-1. This approval covers the boundaries above; it does not pre-approve
remote networking, paid usage, new data collection, or destructive actions.
