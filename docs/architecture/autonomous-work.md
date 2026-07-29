# Autonomous work coordinator

## Purpose

The local coordinator answers one question: **what is the next safe thing that
can happen to this request?** It does not replace request, repository, provider,
validation, or approval state. Those owned systems remain canonical.

## Modes

| Mode | Behavior |
| --- | --- |
| Guided | Recommends one next action; performs nothing automatically |
| Balanced | Preserves the policy boundary for future low-risk assistance; currently recommendation-first |
| Autonomous | May perform a typed safe action when existing authority already permits it |

Guided is the default. A project must explicitly confirm broader automation.
A request may choose a more conservative mode, but never a broader mode than
its project.

## Non-bypassable boundaries

The coordinator stops before:

1. approving a request contract;
2. accepting missing or ambiguous input;
3. approving a grounded plan;
4. authorizing isolated execution;
5. sending a provider proposal request;
6. accepting untrusted provider output;
7. approving exact file changes;
8. approving a commit; and
9. approving canonical integration.

No mode can change the zero-dollar automatic spend limit, provider admission,
privacy classification, repository containment, deterministic validation, or
uncertain-effect rules.

## State and ownership

`autonomy-state.json` lives in the private runtime directory with mode `0600`.
It contains opaque project/request identities, preferences, request overrides,
short coordinator leases, and bounded receipts. It contains no prompt, source
content, credential, personal path, or provider response.

Every mutation binds to the exact request `updatedAt` revision and requires an
idempotency key. A short single-owner lease prevents concurrent safe steps.
The service writes state atomically and reconstructs recommendations from the
canonical request store after restart.

## Scheduling and recovery

Known provider retry times appear as scheduled waits. Waiting does not consume
a task failure budget and does not cause constant retries. Active validation is
reported as healthy until its own bounded timeout. Expired coordinator or
request leases require reconciliation from canonical state before another
effect.

The background loop is serialized, wakes at a bounded interval, and remains
idle when nothing is automatically eligible. Shutdown stops future wakes before
the control plane closes.

## Public surface

The loopback API exposes:

- `GET /api/v1/autonomy`
- `POST /api/v1/autonomy/projects/:projectId/mode`
- `POST /api/v1/autonomy/projects/:projectId/pause`
- `POST /api/v1/autonomy/requests/:requestId/mode`
- `POST /api/v1/autonomy/requests/:requestId/advance`

All mutations require strict schemas and idempotency keys. The Studio client
accepts only loopback HTTP origins, omits credentials, bounds responses, and
validates every payload.

## Verification

```sh
npm run verify
npm run studio:release-check
```

Tests cover planner stages, authority boundaries, mode escalation, pauses,
revision mismatch, private persistence, restart, receipts, origins, methods,
idempotency, malformed and oversized responses, UI fallback states, keyboard
operation, and removal of the simulated Work route.
