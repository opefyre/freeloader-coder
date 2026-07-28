# Understand plans and approvals

A plan is a frozen explanation of what the pipeline intends to change and how
success will be proved. Approval applies to that exact plan revision, not to
future changes.

Before approval, review:

- the requested outcome and explicit non-goals;
- assumptions, with blocking assumptions separated from informational ones;
- the bounded task graph and dependencies;
- expected files, tools, permissions, external writes, and cost;
- deterministic validation, independent review, and undo behavior.

Editing any material scope, permission, destination, or cost invalidates the
approval and creates a new revision. Read-only inspection does not require the
same approval as a source edit, external comment, push, or deletion.

If intent is unclear, ask the pipeline to revise the plan. Do not approve a
guess to make the workflow continue.

See the [approval matrix](../governance/approval-matrix.md) for effect classes.
