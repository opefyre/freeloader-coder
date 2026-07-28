# PIPE-52 — Conversation and operational-reference contracts

Status: verified locally on 2026-07-28.

## Outcome

Pipeline Studio now separates editable conversation presentation from immutable
execution references. Chat can explain, infer, ask, plan, request approval, and
display observed progress, but it cannot rewrite task, event, artifact,
citation, approval, or action identity by editing or deleting visible text.

The v1 contract covers user, assistant, system, tool, question, plan, approval,
progress, result, and error messages, plus intent, citation, action, artifact
reference, branch, retry, retention, deletion, redaction, replay, and export.

## Acceptance-criteria evidence

### AC1 — Display mutation cannot rewrite execution history

- `editing and deleting display content cannot rewrite authoritative execution
  references`
- The append-only journal stores canonical message records once. Later edits and
  deletion events affect only the display projection.
- Replay rejects identity changes, sequence gaps, duplicate events/messages,
  missing branches, invalid branch points, and retries of unknown messages.

### AC2 — Operational claims resolve to evidence or declare interpretation

- `progress and result claims require evidence while explanations and inferences
  remain explicit`
- Progress and result messages require at least one immutable evidence reference.
- Assistant, system, tool, plan, approval, progress, result, and error messages
  must classify their claim as evidence, explanation, or inference.
- Observed actions require an observed postcondition and event evidence;
  irreversible actions require approval.

### AC3 — Replay and export preserve order and references

- `branch, retry, replay, and export preserve ordering and immutable references`
- `journal persistence is atomic/private and export honors redaction without
  losing references`
- Conversation journals are atomically persisted with owner-only file
  permissions.
- Deterministic export preserves branch, sequence, message, claim, task, event,
  artifact, citation, approval, and action references.
- Deleted text exports as `[deleted]`; fully redacted text exports as
  `[redacted]`; neither operation removes canonical references.
- Every export states that conversation display is not authoritative execution
  history.

## Verification result

- Setup check: passed
- Format check: passed
- Lint: passed
- Typecheck: passed
- Fresh build: passed
- Automated tests: 83 passed, 0 failed

All fixtures are synthetic. No credential, private prompt, personal data, or
provider call was used.
