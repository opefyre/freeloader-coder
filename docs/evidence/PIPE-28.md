# PIPE-28 evidence

## Outcome

ADR-001 approves a single-computer, local-first modular core with supervised
execution workers and optional distribution.

## Acceptance criteria

- AC1 — PASS: ADR-001 compares an in-process monolith, fine-grained
  microservices, and the selected hybrid; it records consequences, migration
  stages, rollback, and explicit replacement triggers.
- AC2 — PASS: the default topology requires one computer; the core binds only
  authenticated loopback and local workers use inherited stdio without ports.
- AC3 — PASS: remote workers and OAuth brokers are removable adapters; local
  startup, canonical state, review, recovery, export, and deletion do not
  depend on them.

## Verification

- Required process, protocol, lifecycle, crash, storage, trust, outbound,
  migration, rollback, and replacement sections are present.
- `system-context.md` independently maps authority and required versus optional
  topology.
- Markdown and whitespace validation pass before commit.

## Limitations carried forward

PIPE-29 must prove clean setup, PIPE-30 must make schemas/replay executable, and
PIPE-31 must prove parity and single-machine migration. This decision does not
claim those implementation tickets are already complete.

## Isolation

Only the independent Pipeline Studio repository changed. The Household
application and its running autonomous pipeline remain untouched.
