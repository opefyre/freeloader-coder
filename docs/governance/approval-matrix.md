# Approval matrix

One person may hold multiple roles in a small project, but must approve each
role explicitly. The implementer may not self-approve a material exception.

| Change class | Required owner | Required approver(s) | Blocks work when unresolved | Minimum evidence |
| --- | --- | --- | --- | --- |
| Product promise, workflow, state language | Product | Product owner | Yes | Product decision, user outcome, failure states, metric |
| Architecture, schema, API, event, compatibility | Engineering | Technical owner | Yes | ADR, alternatives, compatibility and rollback tests |
| Authentication, authorization, credentials, destructive action | Security | Security owner + technical owner | Yes | Threat review, least privilege, denial and recovery tests |
| Data collection, retention, third-party transmission | Privacy | Privacy owner + product owner | Yes | Data map, purpose, retention, redaction/deletion test |
| Keyboard, screen reader, zoom, contrast, motion | Accessibility | Accessibility owner + product owner | Yes | Named accessibility evidence across supported states |
| Model/provider routing or prompt-data eligibility | AI platform | Privacy owner + technical owner | Yes | Provider terms/classification, quota, fallback, circuit test |
| Connector permissions or external mutation | Integrations | Security owner + connector owner | Yes | Scope map, idempotency, audit, compensation test |
| Paid usage or billing enablement | Product owner | Account owner, explicitly | Always | Provider, hard cap, duration, alert, kill switch, rollback |
| Breaking or irreversible change | Owning team | Product + technical owner | Yes | Deprecation record, migration, compatibility window, rollback |
| Risk acceptance | Risk owner | Owner of affected domain | Yes for high/critical | Likelihood, impact, controls, expiry, follow-up |

## Approval behavior

- `Approved`: named approvers and dates recorded; scoped implementation may
  begin.
- `Changes requested`: affected work remains blocked until the record changes
  and is re-approved.
- `Rejected`: no implementation may ship under that proposal.
- `Expired`: time-bounded approvals revert to unresolved.
- Conflicts escalate to the project owner; they are not decided by model vote.

Emergency changes require the same evidence, but the record may be completed
immediately after containment. The release remains blocked until retrospective
approval, durable tests, and rollback evidence exist.
