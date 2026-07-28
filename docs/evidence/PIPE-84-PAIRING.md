# PIPE-84 — Device pairing

- AC1: pairing codes are short-lived, single-use, mutually authenticated, and controller-confirmed.
- AC2: revocation blocks new leases immediately and increments the device credential version.
- AC3: pairing records contain fingerprints and references, never controller secrets, chat content, or project files.
- Evidence: `packages/distributed/src/pairing.ts`, replay/expiry tests, and Private device mesh UI.
