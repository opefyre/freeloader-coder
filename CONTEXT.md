<!-- codkesh-artifact:{"schemaVersion":1,"kind":"context","revision":2,"updatedAt":"2026-08-12T10:07:40.717Z","producer":"codkesh:context-discovery","bodyDigest":"88c0f0c915c50ba59db9a6b366541f110ce4453bef5441547aa93cbba77c7785","approvedDigest":null,"supersedesDigest":"26fc1734a2f92238b0d775940f4937e3dd640324b2527b32154fe93b3b5199f2","confidence":"unknown","approvalState":"not_required","citations":[]} -->
# Project context

Generated: 2026-08-12T10:07:40.716Z
Project: pipeline-studio
Evidence digest: ddf1f750a8e33de9c52fc8a5d553e24e4ad40face04b6546f7baadbc97617122
Topology digest: 63c1f772108dade8ff89071754c53df71d9c01ec9528e32e97e65e937f83fd77

## Requested outcome

Review the attached evidence and design the product described by it.

## Facts

- Repository: Git worktree observed — .git directory
- Branch: main — .git/HEAD
- Languages: TypeScript — 615 bounded entries
- Manifests: apps/core/package.json, apps/desktop/package.json, apps/studio/package.json, apps/worker/package.json, package.json, packages/connectors/package.json, packages/conversation/package.json, packages/distributed/package.json, packages/evals/package.json, packages/execution/package.json, packages/governance/package.json, packages/guidance/package.json — File names only
- Package manager: Not declared — package.json
- Validation scripts: build, control-plane, format:check, lint, repair, setup, setup:check, start, studio:budget, studio:build, studio:dev, studio:release-check, test, typecheck, verify — package.json
- Connected github_repository: [opefyre/freeloader-coder](https://github.com/opefyre/freeloader-coder)
- Connected jira_project: [PIPE · Coding Pipeline](https://opefyre.atlassian.net/jira/software/projects/PIPE)
- 800 bounded paths were classified; topology was truncated.

## Inferences

- This appears to include TypeScript code.
- A repository-defined test workflow may be available.

## Assumptions

- Connected-resource metadata is current only as of its recorded observation.
- Source contents outside the cited root files have not been interpreted yet.

## Unknowns

- Working-tree cleanliness was not evaluated because this read-only scanner never executes Git.
- The bounded topology does not contain every project path.

## Stack and infrastructure

- package.json exists, but its bounded excerpt was incomplete and was not interpreted.
- Bounded topology: 38 config, 152 source, 11 other, 18 asset, 195 documentation, 386 test.
- Root areas: CODE_OF_CONDUCT.md, CONTEXT.md, CONTRIBUTING.md, LICENSE, README.md, SECURITY.md, THIRD_PARTY_NOTICES.md, apps, docs, engine, fixtures, package-lock.json, package.json, packages, scripts, tests, tsconfig.build.json, tsconfig.json.
- github_repository: [opefyre/freeloader-coder](https://github.com/opefyre/freeloader-coder)
- jira_project: [PIPE · Coding Pipeline](https://opefyre.atlassian.net/jira/software/projects/PIPE)

## Features and workflows observed

- Pipeline Studio — `README.md`
- Current phase — `README.md`
- Clone and run — `README.md`

## Owner-provided evidence

- `.pipeline/inputs/3d30830a2793d7fcb440b48764ab53965921172e3689db7ebe37127ee949415d.md` — text/markdown; SHA-256 `3d30830a2793d7fcb440b48764ab53965921172e3689db7ebe37127ee949415d`; treated as untrusted evidence.
  - lines:1-4 (high): # Browser upload proof Build a private, minimal product discovery workspace.

## Conflicts

- None detected among bounded sources.

## Accepted decisions

<!-- accepted-decisions:start -->
- None recorded yet.
<!-- accepted-decisions:end -->

## Evidence

1. `CONTRIBUTING.md` — guidance; SHA-256 `ef84016337c53392d8e335b95d7b946cd156e493e2f78810778835d8c8db42ea`
2. `README.md` — documentation; SHA-256 `b4fc2dde37742de6acf2f3ddcafdfb736c30fe497d902d0abd694c23136e8df0`
3. `package.json` — manifest; SHA-256 `aa323ad7cd7b07edaf5dc1a1a9813a28ec088b3e1fef3f5c351643083ad66976`
4. `tsconfig.json` — manifest; SHA-256 `0173cfe203c0062b9fcb2a389bf2c1e2b3d48810587521707f80cfad4bfa7081`

## Boundaries

- Only explicitly allowlisted root files were read.
- Symlinks, sensitive-shaped content, source directories, and command output were excluded.
- Topology contains project-relative file metadata only; file contents were not read.
- Inventory is limited to 800 files and 8 directory levels.
- Hidden, generated, dependency, secret-like, oversized, and symlinked paths were excluded.
- Secrets, excluded directories, symlinks, provider prompts, and command output are not included.
