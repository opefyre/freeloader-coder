# Connected Work architecture

GitHub and Jira are external systems of record. Pipeline Studio keeps local
execution authoritative while treating every external write as a separately
approved, idempotent effect with observable postconditions.

## Authorization boundary

- GitHub defaults to a repository-scoped App installation or device flow.
- Jira uses short-lived state, PKCE, a protected code exchange, and vault-backed
  refresh material.
- The broker stores no source, issue content, prompt, attachment, or long-lived
  user token.
- Returned scopes must be a subset of requested scopes. Revocation stops new
  effects without discarding local work.
- GitHub Models is a separate permission and cannot widen repository access.

## Local import boundary

- Repository selection uses stable repository IDs and exact grants.
- Existing unrelated folders are never overwritten.
- Refresh checkpoints local work and turns divergence into a guided conflict.
- Jira selection stores stable cloud, project, board, issue, and source-revision
  identifiers.
- Every derived task cites both its Jira revision and project-grounding digest.
- One Jira issue can own only one active local task graph.

## External write boundary

- GitHub publication previews the repository, base branch, changed files,
  checks, branch, commit, pull request, reviewers, undo, and exact effect.
- A checkpoint/repository/branch digest is the publication idempotency key.
- Success requires observing exactly one branch, commit, and pull request.
- Jira synchronization previews the transition, comment, links, and evidence.
- `Done` requires deterministic validation and independent review; model output
  or queue state is never sufficient.
- Retry first searches for the existing idempotency marker and never duplicates
  comments, links, transitions, branches, commits, or pull requests.

## Offline and failure behavior

Local projects, checkpoints, conversations, tasks, validation, and evidence
remain usable while GitHub, Jira, or the OAuth broker is unavailable. Permission
changes, newer Jira revisions, protected branches, conflicts, quota, and
uncertain postconditions preserve local work and ask for the smallest safe
decision.
