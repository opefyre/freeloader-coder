# PIPE-88 — Canonical local data lifecycle

## Delivered

- Typed ownership and lifecycle records for projects, tasks, runs, conversations, messages, artifacts, evidence, audit events, settings, and credential references.
- Foreign-key validation, retention reasons, versioning, content-addressed large artifacts, and a hard prohibition on credential material in the data graph.
- Deterministic storage accounting and cleanup eligibility that preserves active, retained, checkpointed, audited, and referenced records.

## Proof

- Domain: `packages/data-lifecycle/src/schema.ts`
- Tests: `tests/data-lifecycle.test.ts`
- UI: Settings → Local data and reliability → Storage ownership
