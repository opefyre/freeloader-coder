# Tool & Device Fabric

Status: implemented for Sprint 13 contract and interactive demo  
Source work: PIPE-80 through PIPE-87

## Authority boundaries

The controller is the sole authority for canonical task state, grants, leases, effect reconciliation, and verified completion. Models, tools, MCP servers, extensions, and paired workers may propose or execute bounded work, but they cannot mint permissions, assign themselves a lease, or declare their own output verified.

Tool discovery always enters quarantine. A project-specific grant must match the exact tool identity, version, capabilities, and effects before dispatch. Results are admitted only after output-schema validation, declared-effect reconciliation, and an observed postcondition.

## Tool lifecycle

1. Parse a versioned tool or extension contract.
2. Reject malformed, unsigned, incompatible, regressing, or over-permissioned definitions.
3. Quarantine discovered MCP tools.
4. Review publisher, source, signature, permissions, effects, data use, cost, compatibility, and support.
5. Create a time-bounded project grant.
6. Dispatch through the governed gateway with an idempotency key and deadline.
7. Validate result schema, observed effects, and postcondition.
8. Record a privacy-safe receipt; compensate or quarantine bounded failures.
9. Drain work, reconcile effects, revoke grants, and delete credential references when removed.

Local MCP uses an allowlisted executable identifier rather than an arbitrary shell string. Remote MCP requires HTTPS and an explicitly pinned host. Credentials remain vault references.

## Device lifecycle

Pairing uses a short-lived single-use code, mutual fingerprints, and explicit controller confirmation. Successful pairing creates a device-bound credential. Replay and expiry fail closed. Revocation immediately blocks new leases and rotates the credential version.

The worker signs a capability report. Admission compares each claimed capability with locally observed CPU, memory, disk, runtime, model, container, and validator evidence. Updates require a valid signature and rollback target; active leases drain before installation.

## Scheduling and recovery

Scheduling filters devices by trust, revocation, resource health, privacy, work profile, runtime, model, and memory. It then ranks eligible devices by source locality, current load, container availability, and the preference to keep heavy work off the controller.

One authoritative lease exists per task. Worker loss does not immediately requeue work. The controller waits for lease expiry, reconciles observed effects, then issues a new lease with the same idempotency boundary. Slow active model or validation work remains `slow_active`; repair never restarts an active request.

## Verification

Deterministic suites cover malformed contracts, permission expansion, undeclared effects, output and postcondition validation, MCP quarantine and bounded failure, extension migration guidance, pairing expiry and replay, capability overclaim, signed updates, privacy-aware scheduling, duplicate lease prevention, slow-active classification, unsafe repair blocking, redacted support export, and the responsive interactive Studio surface.

Production deployment and GitHub Actions are intentionally outside this sprint. Verification and delivery remain local until final release hardening.
