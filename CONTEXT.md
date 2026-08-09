# Project context

Generated: 2026-08-09T11:45:48.682Z
Project: pipeline-studio
Evidence digest: 36956a01b95d36e19f597875be5ee5d3dc1531ea544ebc5b0f337d6df04a405f
Topology digest: 1bfcb6b48a1d01a44a780c70788fce5e39d5930715737b88c749fa4fd4da8b4e

## Requested outcome

Build a reliable autonomous multi-project product development pipeline for non-developer vibecoders, from discovery and planning through Jira-managed implementation, QA, approvals, infrastructure, launch, and progress reporting.

## Facts

- Repository: Git worktree observed — .git directory
- Branch: main — .git/HEAD
- Languages: TypeScript — 615 bounded entries
- Manifests: apps/core/package.json, apps/desktop/package.json, apps/studio/package.json, apps/worker/package.json, package.json, packages/connectors/package.json, packages/conversation/package.json, packages/distributed/package.json, packages/evals/package.json, packages/execution/package.json, packages/governance/package.json, packages/guidance/package.json — File names only
- Package manager: Not declared — package.json
- Validation scripts: build, control-plane, format:check, lint, repair, setup, setup:check, start, studio:budget, studio:build, studio:dev, studio:release-check, test, typecheck, verify — package.json
- Connected github_repository: [opefyre/freeloader-coder](https://github.com/opefyre/freeloader-coder)
- 609 bounded paths were classified; topology was not truncated.

## Inferences

- This appears to include TypeScript code.
- A repository-defined test workflow may be available.

## Assumptions

- Connected-resource metadata is current only as of its recorded observation.
- Source contents outside the cited root files have not been interpreted yet.

## Unknowns

- Working-tree cleanliness was not evaluated because this read-only scanner never executes Git.

## Stack and infrastructure

- Package manager: Not declared [3]
- Validation and automation scripts: setup, start, control-plane, repair, studio:dev, studio:build, studio:budget, studio:release-check, site:dev, site:build, site:budget, site:release-check, setup:check, format:check, lint, typecheck, build, test, verify [3]
- Root dependencies observed: @tailwindcss/vite, @types/node, @types/react, @types/react-dom, @vitejs/plugin-react, tailwindcss, typescript, vite [3]
- Bounded topology: 31 config, 241 source, 6 asset, 182 documentation, 3 other, 146 test.
- Root areas: CODE_OF_CONDUCT.md, CONTEXT.md, CONTRIBUTING.md, LICENSE, README.md, SECURITY.md, apps, docs, fixtures, package-lock.json, package.json, packages, scripts, tests, tsconfig.build.json, tsconfig.json.
- github_repository: [opefyre/freeloader-coder](https://github.com/opefyre/freeloader-coder)

## Features and workflows observed

- Pipeline Studio — `README.md`
- Current phase — `README.md`
- Clone and run — `README.md`

## Conflicts

- None detected among bounded sources.

## Accepted decisions

<!-- accepted-decisions:start -->
- None recorded yet.
<!-- accepted-decisions:end -->

## Evidence

1. `CONTRIBUTING.md` — guidance; SHA-256 `ef84016337c53392d8e335b95d7b946cd156e493e2f78810778835d8c8db42ea`
2. `README.md` — documentation; SHA-256 `508d7da7935e0d3af06980489cf6c621caf98b33ecef1868fcedd81153384513`
3. `package.json` — manifest; SHA-256 `3f1e85c722cb2a38cd698d7d9759a067f7cb41dfa075738e45387a5e3402214a`
4. `tsconfig.json` — manifest; SHA-256 `0173cfe203c0062b9fcb2a389bf2c1e2b3d48810587521707f80cfad4bfa7081`

## Boundaries

- Only explicitly allowlisted root files were read.
- Symlinks, sensitive-shaped content, source directories, and command output were excluded.
- Topology contains project-relative file metadata only; file contents were not read.
- Inventory is limited to 800 files and 8 directory levels.
- Hidden, generated, dependency, secret-like, oversized, and symlinked paths were excluded.
- Secrets, excluded directories, symlinks, provider prompts, and command output are not included.

<!-- context-digest:e2bd9cf332f03674ae038de8fd8cfa4ffcf6dfeb23be1887a6fab236d452557f -->
