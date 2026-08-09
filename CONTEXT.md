# Project context

Generated: 2026-08-09T11:10:32.007Z
Project: pipeline-studio
Evidence digest: 36956a01b95d36e19f597875be5ee5d3dc1531ea544ebc5b0f337d6df04a405f
Topology digest: 2a7ae66a0ba1197f0fe76466a711cdab4dacba582bc4fa3efa8c75dfcf9aaa01

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
- 604 bounded paths were classified; topology was not truncated.

## Inferences

- This appears to include TypeScript code.
- A repository-defined test workflow may be available.

## Assumptions

- Connected-resource metadata is current only as of its recorded observation.
- Source contents outside the cited root files have not been interpreted yet.

## Unknowns

- Working-tree cleanliness was not evaluated because this read-only scanner never executes Git.

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

<!-- context-digest:72500f2ecb41c0d2bbf857d3fe7cf6a058ca246931e5a705e5aedeea7d1aaa9f -->
