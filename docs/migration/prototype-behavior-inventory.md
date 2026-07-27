# Prototype behavior inventory

Source: quarantined snapshot `_reference/household-pipeline`, captured from
prototype commit `de77c93c4016d452bb10fa0489f4457e5c2508d2`.

The snapshot is evidence, not a dependency. Product code cannot import it.

| Capability | Evidence in snapshot | Decision | Generalized owner | Required parity |
| --- | --- | --- | --- | --- |
| Durable task stages and terminal states | `state.mjs`, `orchestrator.mjs` | Retain | orchestration + storage | ordered transition and restart fixtures |
| Lease, bounded attempt, retry schedule | `state.mjs`, `worker.mjs` | Retain | orchestration | expiry, duplicate claim, exhausted budget |
| Idempotent side-effect ledger | `state.mjs`, `repository.mjs` | Retain | storage + tools | replay, completed effect, unknown outcome |
| Readiness and task-graph decomposition | `readiness.mjs` | Retain | orchestration | acyclic graph, overlap ordering, dependency block |
| Grounding source hashes and invariant rules | `grounding.mjs` | Retain | orchestration + policy | deterministic digest, source limits, rule preservation |
| Isolated branches/worktrees and safe paths | `repository.mjs` | Retain | tools | traversal rejection, bounded files, diff evidence |
| Patch/edit normalization | `repository.mjs` | Redesign | tools | structured edits first; patch compatibility fixture |
| Fast and full deterministic validation | `validator.mjs` | Retain | validation | registered commands, immutable input fingerprint |
| Bounded healing after validation | `orchestrator.mjs` | Retain | orchestration | retry budget, changed strategy, quarantine |
| Functional and design review quorum | `orchestrator.mjs` | Retain | orchestration + evals | dissent, severe finding, needs-user |
| Provider eligibility and preference | `provider-router.mjs` | Retain | providers + policy | role/kind/data policy and deterministic ranking |
| Quotas and circuit breakers | `provider-router.mjs` | Retain | providers | capacity, cooldown, fallback, recovery |
| Model result schema validation | `schemas.mjs`, `model-client.mjs` | Retain | schemas + providers | malformed/unknown output fails closed |
| Result cache | `result-cache.mjs` | Retain with limits | providers | privacy eligibility, TTL, stable request digest |
| Post-integration validation | `integration.mjs` | Retain | orchestration + validation | failed integration cannot become complete |
| CLI doctor and health | `cli.mjs` | Redesign | core + support | component-owned health and safe actions |
| Embedded server-rendered dashboard | `server.mjs` | Reject | studio UI | replaced by versioned API/SSE and shared state |
| Machine launch definitions | deployment snapshot | Reject | optional platform adapter | never required for local startup |
| Private-network addresses and two-host topology | deployment/config snapshot | Reject | optional remote-worker adapter | one-machine path requires no private network |
| Fixed account, repository, path, issue-system coupling | config/state/orchestrator | Reject | injected project/connector adapters | no product default contains prototype identity |
| Fixed provider/model role lists | orchestrator/router config | Reject | provider registry and routing policy | no model name is required by core |

## Extraction order

1. State/event contracts and deterministic replay — PIPE-30.
2. Workflow stage engine with injected repository, implementation, validation,
   healing, review, and integration adapters.
3. Readiness, grounding, safe repository operations, and deterministic
   validation.
4. Provider routing, quotas, circuits, and result validation.
5. Durable storage, reconciliation, and optional remote-worker transport.

Each retained row needs a named regression fixture before compatibility code is
retired. A row marked Redesign must preserve the user-facing outcome, not its
prototype API. Rejected rows must have a test or repository check preventing
their accidental reintroduction.
