# PIPE-81 — Constrained MCP lifecycle

- AC1: every discovered server and tool begins in `quarantined`; enabling requires explicit effect review and risk acknowledgement.
- AC2: MCP failure is separated from canonical task transition and bounded retries return to quarantine.
- AC3: recent-use state, revocation, and configuration removal are represented by the lifecycle contract and interactive demo.
- Evidence: `packages/tools/src/mcp.ts`, `tests/mcp-extension.test.ts`, and Constrained MCP lifecycle UI.
