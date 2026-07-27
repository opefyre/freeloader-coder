# Protocol compatibility and migration

## Version policy

Every persisted or transported record declares `schemaVersion`. Version 1 is
the current supported major version. Readers reject an unsupported major,
unknown top-level field, invalid enum, or malformed value; they never guess.

Strict top-level records protect canonical meaning. Forward-compatible,
non-authoritative additive data may appear only in an explicit `extensions`
object with a namespaced key. An extension cannot change required validation,
permissions, state transitions, evidence, or postconditions. Promoting an
extension to canonical behavior requires a schema revision and migration.

## Compatibility guarantees

- Patch changes fix implementation without changing valid wire data.
- Additive minor behavior uses namespaced extensions or a new optional field
  only after all supported readers have a defined default.
- Breaking semantic or structural changes require a new major version.
- Writers emit the oldest supported form that preserves the requested meaning.
- Readers preserve unknown namespaced extensions during read/write cycles.
- Unsupported majors fail closed with an owned, actionable safe error.

## Migration

Migrations are pure, deterministic, ordered, and idempotent at the migration
journal level. The original record and migration evidence remain recoverable
until rollback expires.

The first compatibility fixture migrates legacy task v0:

- `summary` → `title`;
- `queued`, `active`, `complete` → `ready`, `working`, `done`;
- revision starts at zero;
- origin is recorded as a non-authoritative namespaced extension.

Before removing a reader or migration:

1. inventory persisted and in-flight versions;
2. publish deprecation and compatibility dates;
3. provide dry-run, backup, migration, integrity, and rollback procedures;
4. observe completion without collecting record contents;
5. retain the prior compatible release through the rollback window.

## Event replay

Events are immutable and ordered by a contiguous positive sequence. Replay
rejects gaps, duplicate creation, stale revisions, missing tasks, overlapping
leases, and mismatched release. Materialized projections can be discarded and
rebuilt; identical journals must produce identical authoritative state.

## Error separation

The transport-safe error contains code, owner, safe message, next action,
retryability, and an opaque diagnostic ID. Stack traces, paths, credentials,
request bodies, provider payloads, and exception causes stay in a local
diagnostic record and are never serialized through the safe schema.
