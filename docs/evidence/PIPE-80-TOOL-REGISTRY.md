# PIPE-80 — Typed tool registry

- AC1: `ToolRegistry` rejects malformed, unsigned, unknown, incompatible, expired, revoked, and over-permissioned tools.
- AC2: dispatch derives from the registered contract and exact project grant; prompt or extension metadata has no policy path.
- AC3: deterministic tests cover version replay, duplicate registration, undeclared effects, timeout deadline, revocation, postcondition failure, and compensation metadata.
- Evidence: `packages/tools/src/registry.ts`, `tests/tool-registry.test.ts`, and the Permissioned catalogue UI.
