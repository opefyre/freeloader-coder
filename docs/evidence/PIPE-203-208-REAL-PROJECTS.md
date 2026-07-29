# PIPE-203–208: real local projects proof

## Outcome

The Projects workspace now contains Pipeline Studio's first real feature-data
journey. A user can register an existing local Git worktree, inspect bounded
repository metadata, rescan it, survive runtime interruption, and forget only
the registration. The existing future execution journey remains visibly
labelled as a synthetic example.

## Delivered boundary

- Versioned strict contracts separate observed facts, bounded inferences, user
  decisions, warnings, freshness, and opaque project identity.
- A deterministic scanner resolves the selected real path, requires a Git
  worktree, and inspects bounded directory entries and explicitly allowed small
  manifests.
- `.git` internals other than `HEAD`, dependency trees, build output, likely
  secret directories, `.env` files, binaries, and file content outside the
  allowed `package.json` projection are excluded.
- The `package.json` projection reads only package-manager identity and script
  names. It does not expose dependency values, script command values, or source.
- The scanner never runs Git, shell commands, models, providers, connectors, or
  network discovery. Working-tree cleanliness is therefore honestly marked
  **not evaluated**.
- The private registry is versioned, strict, idempotent by canonical real path,
  atomically replaced, and permission-restricted.
- Malformed registry state is preserved and rejected rather than overwritten.
- Browser projections contain no absolute project path.

## Local API

- `GET /api/v1/projects` lists safe public observations.
- `POST /api/v1/projects` registers and scans an explicit absolute path.
- `POST /api/v1/projects/:id/rescan` refreshes read-only metadata with
  single-flight behavior.
- `DELETE /api/v1/projects/:id/registration` removes only local registry
  metadata.
- Mutations require exact loopback origin, strict method/path/schema, bounded
  content, and an idempotency key where registration can be replayed.
- Safe user-correctable request and project failures return bounded 4xx
  responses; unexpected failures remain generic.

## Automated evidence

The complete offline suite passes with **469/469 tests**. Sprint tests cover:

- strict contracts, duplicate identity, and unknown/path-shaped public fields;
- restart persistence, idempotent registration, atomic private state, malformed
  state preservation, safe forget, and repository file preservation;
- root/broad/missing/non-Git path rejection and duplicate display names;
- secret, dependency, and ignored-content exclusion from browser data;
- loopback origin, method, schema, body, idempotency, list, register, rescan,
  and forget API behavior;
- loopback-only browser clients, malformed/oversized response rejection, and
  invalid opaque identity rejection;
- live Projects composition, empty/offline/working/ready states, facts,
  inferences, decisions, limitations, rescan, and safe forget copy.

## Browser evidence

A temporary isolated runtime was used so no QA registration remained in the
product state.

- Empty state correctly identified that no real project was registered.
- The Pipeline Studio repository registered through the browser and showed an
  opaque identity, branch, TypeScript, bounded manifest names, package-manager
  evidence, validation script names, inferences, decisions, and the Git-status
  limitation.
- No absolute repository path or source content appeared in the rendered
  observation.
- Rescan completed and refreshed its evidence.
- Forget displayed an explicit repository-preservation confirmation, returned
  to the empty state, and left the repository untouched.
- A protected root path was rejected and did not create a registration.
- With Studio kept running, stopping only the control plane changed the panel
  to **Runtime offline** and preserved the last safe project view. Restarting
  the control plane restored **Live local registry** without a page reload.
- A `390 × 844` mobile check passed with
  `scrollWidth = innerWidth = 390`.
- Light and dark themes both applied, and the browser console contained no
  warnings or errors.

## Explicit non-actions

No source mutation, repository command, GitHub/Jira operation, model/provider
request, credential access, paid usage, analytics transmission, deployment, or
repository deletion is introduced by this sprint.
