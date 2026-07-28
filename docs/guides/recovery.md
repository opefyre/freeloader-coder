# Recover or restore work

Recovery starts by classifying the state, not by repeating actions.

## A run appears stuck

1. Inspect its lease, last event, provider activity, validation activity, and
   next eligible schedule.
2. Active model or validation work inside its configured healthy window is
   running, even if it is slow.
3. A scheduled quota wait is healthy when it has an eligible wake time.
4. Restart only a required stopped service after confirming there is no live
   lease or duplicate worker.
5. Quarantined or **Needs you** work requires the stated decision; automatic
   retries must not bypass it.

## Restore a checkpoint

Preview the affected files, preserve unrelated changes, resolve overlaps
explicitly, approve the bounded restore, and rerun validation. Never use a broad
destructive reset as an automatic recovery mechanism.

## When automatic recovery stops

Pipeline Studio must explain the evidence, attempted repairs, remaining risk,
and smallest useful choice. Export a redacted support report when the system
cannot prove a safe action. See [safe reporting](../support/reporting.md).
