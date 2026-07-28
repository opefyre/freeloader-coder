# PIPE-87 — Device observability

- AC1: recent active model or validation work is classified `slow_active`, not stopped.
- AC2: repair and revoke are blocked while unsafe active work or an unreconciled lease exists.
- AC3: support export replaces device and task identities with scoped references and excludes paths, prompts, source, and secrets.
- Evidence: `packages/distributed/src/observability.ts`, observability tests, device controls, and worker-state simulation.
