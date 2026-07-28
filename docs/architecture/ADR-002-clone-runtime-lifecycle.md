# ADR-002: Clone-based setup and supervised local runtime lifecycle

- Status: Accepted
- Date: 2026-07-28
- Owner: Setup & Runtime
- Jira: PIPE-36
- Affected work: PIPE-37, PIPE-38, PIPE-39
- Depends on: ADR-001

## Decision

Pipeline Studio supports a source-clone distribution with one documented setup command and one start command:

```sh
git clone https://github.com/opefyre/freeloader-coder.git pipeline-studio
cd pipeline-studio
npm ci
npm run setup
npm start
```

`npm run setup` is deterministic and idempotent. It checks the supported runtime, Git, architecture, memory, writable private state, and a loopback-only port. It records only non-secret runtime configuration under the ignored `.pipeline-studio/` directory with user-only permissions. Credentials remain in an operating-system credential store.

The supported first-release matrix is:

| Platform | Architecture | Phase | Isolation |
| --- | --- | --- | --- |
| macOS 14+ | arm64, x64 | Guided Alpha | Native bounded; Docker/Podman optional |
| Linux LTS | arm64, x64 | Guided Alpha | Native bounded; Docker/Podman optional |
| Windows 11 + WSL2 | x64 | Connected Beta | Native bounded in WSL2; containers optional |

Node.js 22+ and npm 10+ are required. A supported computer has at least 8 GB memory and 5 GB free disk for worktrees, validation, and artifacts.

## Runtime ownership

One local core owns one profile through an expiring, renewable lease. It binds only to `127.0.0.1` or `::1`, chooses another bounded port when the preferred port is occupied, and refuses a second live controller for the same profile.

The core supervises worker, validator, preview, and optional local-model processes. Before shutdown, sleep, update, or interruption, active services record their checkpoint. Restart reconciliation classifies every effect as:

- not started and safe to resume with the same idempotency key;
- attempted with unknown outcome and therefore blocked from automatic replay;
- postcondition verified and already complete.

One-click Repair may release an expired lock, select a free loopback port, rebuild derived projections, and restart stopped services. It never deletes projects, credentials, checkpoints, or the authoritative journal. Storage-integrity uncertainty stops repair and asks for the smallest safe user decision.

## Sandbox choice

Docker and Podman are optional. When available, Pipeline Studio may select strong container isolation. Supported lightweight projects work in a clearly labeled **Native bounded mode** with reduced isolation and strict workspace, command, network, output, protected-path, and secret restrictions.

If project or policy requirements demand strong isolation and no supported container exists, execution is blocked. The UI provides exact installation, verification, and Resume steps. Reduced isolation is never labeled or treated as equivalent to a container.

## Update, rollback, and removal

Updates run only after active work reaches a checkpoint. Before dependency or schema changes, the core records the current version, database compatibility, and rollback point. A failed update restores the last compatible source version and rebuilds derived projections from the authoritative journal.

Clean removal stops the local runtime and removes product-owned cache, preview, and temporary-worktree data only after explicit confirmation. Project repositories, user Git history, exported evidence, and operating-system credentials are separate targets and are never silently removed.

## Prototype evidence

The repository already proves:

- a single monorepo installs reproducibly through the lockfile;
- all 190 pre-existing deterministic checks run offline;
- Studio builds to static assets and runs through one Vite command;
- typed execution profiles support strong, reduced, and remote isolation;
- interruption, idempotency, replay, validation, and provider fallbacks are already modeled without requiring cloud infrastructure.

Sprint 5 adds executable preflight, lifecycle, repair, and sandbox-selection contracts plus the guided UI. Evidence is recorded in ticket-specific release documents.

## Rejected alternatives

- Requiring Docker for every user: too much setup burden and false necessity for low-risk projects.
- A daemon fleet or mandatory remote machine: operationally inappropriate for the target audience.
- Ambient shell scripts with secrets in `.env`: incompatible with the credential and audit contract.
- Multiple local controllers sharing a profile: creates duplicate effects and split authority.

## Replacement triggers

Supersede this decision when verified evidence shows:

- the supported workload cannot stay responsive under the supervised local process model;
- native bounded mode cannot enforce its declared restrictions on a supported platform;
- source-clone updates cause unrecoverable migration or support burden;
- loopback browser delivery cannot meet the approved security baseline;
- a supported primary journey genuinely requires a remote control plane.

Any replacement must keep a documented one-computer path or be approved as a material product change with migration, cost, compatibility, and rollback evidence.

