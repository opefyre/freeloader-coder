# PIPE-82 — Extension SDK

- AC1: the local harness validates fixtures and returns deterministic install, contract-check, and safe removal plans.
- AC2: compatibility checks are part of the repository's local full verification suite; hosted CI is deliberately deferred.
- AC3: major updates require explicit migration guidance and permission expansion requires renewed approval.
- Evidence: `packages/tools/src/sdk.ts`, `tests/mcp-extension.test.ts`, and `docs/architecture/tool-device-fabric.md`.
