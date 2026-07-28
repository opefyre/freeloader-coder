# PIPE-47 — Security threat model and release controls

Status: verified locally on 2026-07-28.

## Outcome

Pipeline Studio now carries a versioned executable threat registry covering
project paths, symlinks, hostile hooks, prompt injection, credential
exfiltration, approval replay, provider compromise, and update compromise.

## Acceptance evidence

- Every critical threat declares prevention, detection, response, verification,
  owner, severity, affected surfaces, and residual risk.
- Realpath containment rejects lexical and symlink escape.
- Effect-bound approval receipts reject expiry, policy mismatch, and replay.
- Update artifacts require both signature evidence and the exact SHA-256 digest.
- Residual high provider risk blocks release without a named, time-bounded
  release-owner decision and rationale.
- Changes to providers, tools, connectors, sandboxing, credentials, project
  files, or updates select the affected threats for mandatory review.

## Verification

- `tests/security-threat-model.test.ts`
- Threat and incident guide: `docs/security/threat-model.md`
- Existing execution, scanner, tool-gateway, policy, and provider-failure suites
  remain part of the full release gate.

