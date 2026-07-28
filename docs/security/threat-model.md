# Pipeline Studio threat model

Version 1 · owner: Security maintainer · review trigger: any change to tools,
providers, connectors, sandboxing, credential storage, or updates.

## Trust boundaries

The browser receives product state and masked references only. The authenticated
loopback core owns credentials, policy, canonical state, and effect receipts.
Workers receive scoped references, never raw credentials. External providers
receive only policy-admitted data. Project files, tool processes, connectors,
provider endpoints, and update artifacts remain untrusted until verified.

## Critical threats and controls

| Threat | Prevention | Detection | Response | Verification | Residual risk |
| --- | --- | --- | --- | --- | --- |
| Path escape | Canonical realpath containment | Denial event | Stop effect | Escape fixture | Low |
| Symlink escape | Resolve before access | Integrity event | Stop effect | Symlink fixture | Low |
| Hostile package hooks | Allowlisted commands and bounded isolation | Process receipt | Quarantine project | Hook fixture | Medium |
| Prompt injection | Separate untrusted content from operating rules | Grounding warning | Stop consequential tools | Injection evaluation | Medium |
| Credential exfiltration | OS vault and reference-only tools | Redaction/egress denial | Revoke and rotate | Exfiltration canary | Low |
| Approval replay | Effect-bound nonce, digest, and expiry | Replay denial | Invalidate approval | Replay fixture | Low |
| Provider compromise | Data-class policy and independent validation | Divergence/circuit evidence | Disable provider | Provider-failure drill | High |
| Update compromise | Signed digest verification and rollback | Integrity failure | Retain prior version | Tampered artifact fixture | Medium |

Residual high risk blocks release until an identified release owner records a
time-bounded decision and rationale.

## Incident and rotation response

1. Stop only the affected provider, connector, tool, or update scope.
2. Preserve privacy-safe receipts and checkpoints; never copy credentials into
   tickets, chat, diagnostics, or screenshots.
3. Revoke the provider-side credential and the local vault reference.
4. Rotate with the minimum required permission and rerun cost, quota, account,
   model, and canary verification.
5. Reconcile uncertain effects before retrying work.
6. Update this model and add a regression fixture before restoring the scope.

