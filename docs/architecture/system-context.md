# System context

## Required local path

```text
Browser UI
   │ authenticated loopback HTTP + resumable SSE
   ▼
Local core ───── SQLite event journal + projections
   │
   ├── policy ── secrets adapter / approvals / cost gates
   ├── providers ── local model or explicit outbound provider
   ├── connectors ── GitHub, Jira, future adapters
   └── supervised stdio ── local worker ── tools + validators + worktrees
```

Only the browser-to-core boundary uses a listener in the default topology, and
that listener is authenticated loopback. All components run on one computer.

## Optional extensions

```text
Local core ── authenticated worker adapter ── remote worker(s)
Local core ── optional OAuth broker
```

These adapters can be absent, disabled, or removed without changing canonical
state or preventing local startup, review, recovery, export, or deletion.

## Authority

| Concern | Authority |
| --- | --- |
| Task, lease, approval, recovery, evidence state | Local canonical store |
| Product policy and permissions | Versioned policy records |
| Source history | Selected local Git repository |
| External issue/commit state | Connector projection, reconciled by evidence |
| Model suggestion | Never authoritative |
| Worker report | Candidate event/artifact until validated and committed |
| UI display | Projection of canonical records |
