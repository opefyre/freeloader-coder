# Truthful state language

Version: 1.0

The canonical state is stored independently of presentation. Standard and
Advanced modes render the same record.

| Canonical code | Standard label | Advanced detail | Required evidence |
|---|---|---|---|
| `DRAFT` | Draft | Intent not accepted | Persisted request draft |
| `PLANNED` | Planned | Validated task graph | Graph schema, grounding hash, dependency validation |
| `WORKING` | Working | Active valid lease | Worker identity, unexpired lease, recent activity |
| `WAITING_CAPACITY` | Waiting for free capacity | Eligible routes unavailable or rate limited | Provider outcomes and next eligible time |
| `CHECKING` | Checking the change | Deterministic validation or independent review | Active check/review record |
| `READY_TO_REVIEW` | Ready to review | Required checks and review quorum passed | Check results, review verdicts, diff/artifact references |
| `NEEDS_DECISION` | Needs your decision | Policy or material ambiguity cannot be automated | Exact blocker, safe state, options and consequences |
| `BLOCKED` | Blocked by another step | Dependency postcondition missing | Blocking step and required postcondition |
| `STOPPED` | Stopped after repeated failures | Failure budget exhausted | Error class, attempts, preserved checkpoint, recovery options |
| `KEPT` | Kept in your project | Change committed under acceptance policy | Commit identifier and clean repository postcondition |
| `PUBLISHED` | Published | Remote branch or pull request confirmed | Remote provider acknowledgement plus fetched remote state |
| `RESTORED` | Restored | Selected restore point reapplied and checked | Repository/state comparison and restore verification |
| `CANCELLED` | Cancelled | User or policy stopped future work | Cancellation record and preserved-work disposition |

## Evidence gates for strong claims

### Complete

May appear only when every acceptance criterion maps to passing deterministic
evidence and all required reviews are final.

### Fixed

May appear only when the reported reproduction fails before the change, passes
after the change, and applicable regression checks pass.

### Safe

Avoid as an absolute claim. Prefer the bounded statement, such as “No protected
files changed and all required security checks passed.” If used, it requires
the named policy version and complete applicable evidence.

### Published

Requires confirmation from fetched remote state. A successful local push
command or API acknowledgement alone is insufficient.

## Failure messages

Every failure message contains:

1. What happened.
2. What remains preserved and trustworthy.
3. What could not be verified.
4. The recommended next action.
5. An alternative action when one is safe.
6. A link to evidence or Advanced details.

Example:

> The free providers are temporarily unavailable. Your plan and isolated
> changes are preserved; no paid provider was used. We will retry after the
> earliest reset, or you can add another free provider.

