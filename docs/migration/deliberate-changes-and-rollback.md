# Deliberate migration changes and rollback

## Deliberate changes

- Default topology changes from coordinated machines to one local core plus
  supervised local workers.
- Machine launch configuration becomes an optional platform adapter.
- Private-network routing becomes an optional remote-worker transport.
- The local SQLite event journal, not an external issue tracker, is canonical.
- Provider/model choices move from fixed role lists to a registry and policy.
- Credentials move from provider-specific files to an injected secret store.
- The embedded prototype dashboard is replaced by the Studio API/event UI.
- Structured versioned commands and artifacts replace implicit object shapes.

## Compatibility boundary

The original controller is not upgraded in place. Generalized packages are
developed and proven independently. The quarantined snapshot remains available
only for fixture derivation and behavior comparison.

## Rollout

1. Run synthetic parity fixtures in both behavior models where safe.
2. Run the generalized primary journey locally with fake adapters.
3. Exercise interruption, stale lease, validation failure, healing exhaustion,
   review dissent, external-effect uncertainty, and recovery.
4. Import only explicitly supported test data into a new product state store.
5. Keep the original deployment stopped but recoverable during the evaluation
   window; never point both controllers at the same worktree or state database.

## Rollback

Stop new generalized claims, drain or expire leases, export evidence, verify
repository status, and preserve the new journal. Restore the last compatible
application build and database backup. If returning to the prototype for a
test project, use its original independent repository/state and manually
reconcile commits; never copy the generalized database into it.

Rollback succeeds only after repository head, worktree cleanliness, database
integrity, active leases, and external-effect postconditions are verified.
