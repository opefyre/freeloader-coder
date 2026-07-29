# Contributor setup

## Requirements

- Git
- Node.js 22 or newer (the current LTS line is recommended)
- npm 10 or newer, included with supported Node installers

No cloud account, model key, Docker installation, remote computer, VPN, Jira
account, or GitHub token is required for offline development and verification.

## Clean setup

```sh
git clone <repository-url> pipeline-studio
cd pipeline-studio
npm ci
npm run setup
npm run verify
```

`npm ci` installs the exact dependency graph from `package-lock.json`.
`npm run setup` performs the same idempotent runtime preflight exposed in the
Projects screen and writes only non-secret ignored state.
`npm run verify` is the single local and CI quality gate: environment,
formatting, repository isolation, strict typechecking, build, and offline tests.

Use `npm start` for the complete local experience. It builds the workspace and
supervises both the loopback-only control plane (`127.0.0.1:4312`) and Studio
(`127.0.0.1:4310`). A signal or peer-process failure stops both processes.

Override ports without editing source:

```sh
PIPELINE_STUDIO_STUDIO_PORT=4390 \
PIPELINE_STUDIO_CONTROL_PORT=4392 \
npm start
```

Use `npm run studio:dev` only when developing the interface in isolation. The
runtime indicator will remain offline because that command intentionally does
not start the control plane.

Run `npm run repair` to re-run preflight and reconcile routine stopped-service,
stale-lock, or port-conflict conditions. Repair never removes projects,
credentials, checkpoints, or the authoritative journal.

## Workspace map

- `apps/studio`: web interface
- `apps/desktop`: optional desktop shell
- `apps/core`: local API and lifecycle owner
- `apps/worker`: supervised execution process
- `packages/*`: versioned domain boundaries from ADR-001
- `fixtures`: synthetic, non-personal development scenarios
- `tests`: cross-workspace and offline contract tests

The `_reference` directory is quarantined historical research. It is excluded
from product builds and checks and must never be imported by an application or
package.

## Safe development defaults

Use only synthetic fixtures and fake adapters until you intentionally configure
a provider or connector. Never commit `.env` files, API keys, credentials,
private repository content, or generated runtime state.
