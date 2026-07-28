# PIPE-85 — Worker discovery

- AC1: signed reports are compared with observed hardware, runtime, model, container, and validator evidence; overclaim is rejected.
- AC2: updates require a valid signature and rollback target and drain active leases before installation.
- AC3: sleep, low disk, battery, and thermal states produce explicit safe dispositions.
- Evidence: `packages/distributed/src/worker.ts`, `tests/distributed-fabric.test.ts`, and Capability matrix UI.
