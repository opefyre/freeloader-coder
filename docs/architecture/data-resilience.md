# Data resilience

Pipeline Studio owns canonical local records for profiles, projects, conversations, tasks, dependencies, leases, events, approvals, artifacts, providers, connectors, workers, evaluations, and settings. Credentials remain outside the database; large artifacts are content addressed. Retention and reference invariants prevent cleanup of active, checkpointed, audited, shared, or user-retained data.

Migrations snapshot, verify prerequisites, apply atomically, validate invariants, and commit only after verification. Failure restores the last valid version or enters read-only recovery. Encrypted backup and open per-project export exclude credentials by default. Restore uses explicit conflict choices; deletion starts with a dry run, preserves shared resources, lists external revocations, and provides bounded undo.

Reliability health follows user outcomes and observed model, validation, tool, and safe-progress activity. Service recovery is exact-scope and checks duplicates, active requests, live leases, migrations, and external effects. Interruption reconciliation preserves checkpoints and never repeats completed effects. Stuck work is distinguished from slow work, quota waits, dependency blocks, missing setup, and repeated failure.

Chaos gates inject provider, process, disk, network, database, worker, lease, duplicate-event, preview, and authorization faults. Data-integrity regression or duplicate external effects block release.
