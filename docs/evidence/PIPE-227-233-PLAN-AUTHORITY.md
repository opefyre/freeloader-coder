# PIPE-227–233: real plan authority

## Delivered

- Strict versioned contracts for bounded repository topology, revisioned task
  graphs, edit commands, dependency order, approval evidence, and zero-effect
  authority.
- A canonical-root, breadth-first topology inventory capped at 800 project-relative
  file records and eight directory levels.
- Hidden, generated, dependency, secret-like, oversized, and symlinked paths are
  excluded; topology reads metadata only and never reads arbitrary source content.
- Request-aware deterministic target ranking across observed UI, core,
  orchestration, runtime, provider, documentation, and test areas.
- Grounding citations and proposed implementation targets are separate fields and
  separate concepts throughout contracts, storage, APIs, and UI.
- Revision-checked task title/estimate editing, dependency-safe reordering,
  idempotent replay, stale-edit refusal, and immutable approved plans.
- Approval binds the exact plan revision and zero-effect contract while explicitly
  recording `executionAuthorized: false`.
- Claiming is impossible until the grounded plan is approved.

## Automated evidence

- `npm run verify`: passed, 477/477 tests.
- `npm run studio:release-check`: passed.
- `git diff --check`: passed.
- Studio entry: 398,306 / 450,000 bytes.
- Shared runtime: 189,644 / 210,000 bytes.
- Local request feature: 30,601 / 75,000 bytes.

Coverage includes bounded topology discovery, secret/generated directory exclusion,
request-aware graph generation, grounding/topology/plan digest linkage, unique task
identity, complete order, dependency order, unordered overlap refusal, stale
revision handling, mutation replay, immutable approval, claim gating, private atomic
persistence, guarded loopback edits, and truthful Studio copy.

## Browser evidence

Against the real local control plane and registered `pipeline-studio` repository:

1. Created and approved a real request.
2. Observed 497 bounded repository paths and four request-aware tasks.
3. Verified the first proposed targets included the real local request review UI,
   orchestration planner, planning documentation, and observed tests.
4. Edited a task title and estimate; the plan advanced from revision 1 to 2.
5. Reordered independent work; the plan advanced to revision 3.
6. Approved and froze revision 3; all editors disappeared and immutable approval
   evidence stated that execution remained unauthorized.
7. Completed the zero-effect lease/checkpoint/release proof and archived the QA
   request.
8. Browser console contained zero errors or warnings.
9. At 390 × 844, `scrollWidth === bodyScrollWidth === innerWidth === 390`.

## Exact limitation

This is a real repository-aware planning and approval boundary, not execution.
Target ranking is deterministic path-based inference, not semantic code analysis.
The inventory does not read arbitrary source contents, run commands, contact models
or providers, mutate source, execute checks, perform Git operations, access
credentials, or enable paid usage. Plan approval freezes user intent but grants no
worker or tool capability.
