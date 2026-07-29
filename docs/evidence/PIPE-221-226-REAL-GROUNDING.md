# PIPE-221–226: bounded repository grounding and draft-plan proof

## Delivered

- Strict, versioned grounding and draft-plan contracts with project linkage,
  content digests, provenance, source classifications, limitations, bounded tasks,
  allowed files, acceptance criteria, exclusions, checks, and risk.
- A protected read-only scanner limited to allowlisted root guidance,
  documentation, and manifest files.
- Symlink exclusion, canonical project-path enforcement, per-file and aggregate
  byte limits, likely-secret exclusion, UTF-8 decoding, and SHA-256 source identity.
- Deterministic, request-aware draft-plan creation bound to the exact grounding
  digest and approved zero-effect contract.
- Atomic persistence, idempotent replay, immutable `grounding_created` evidence,
  and stale-source refusal instead of silent plan replacement.
- A guarded loopback-only grounding endpoint and a real review surface that shows
  source paths, classifications, grounding digest, allowed files, and checks.

## Automated evidence

- `npm run verify`: passed, 477/477 tests.
- `npm run studio:release-check`: passed.
- `git diff --check`: passed.
- Studio entry: 398,255 / 450,000 bytes.
- Shared runtime: 189,644 / 210,000 bytes.
- Local request feature: 19,385 / 75,000 bytes.

Coverage includes strict schema parsing, collection cross-link validation,
allowlisted source discovery, canonical paths, secret and symlink exclusion,
private atomic storage, grounding/plan replay, contiguous lifecycle events,
guarded API routing, truthful UI copy, and responsive source presentation.

## Browser evidence

Against the real local control plane:

1. Created a real request for `pipeline-studio`.
2. Approved its zero-effect contract.
3. Grounded it from the registered repository and created a deterministic draft.
4. Observed four real sources: `CONTRIBUTING.md`, `README.md`, `package.json`, and
   `tsconfig.json`, each with an explicit classification.
5. Observed the grounding digest, allowed files, checks, and the explicit
   “not AI decomposition · no execution authority” boundary.
6. Verified the ordered `contract_approved` and `grounding_created` events.
7. Completed claim, checkpoint, release, and archive without invoking a command,
   model, provider, Git operation, or paid service.
8. Browser console contained zero errors or warnings.
9. At 390 × 844, `scrollWidth === bodyScrollWidth === innerWidth === 390`.

## Exact limitation

This slice creates real repository grounding and a real durable draft, but it is
intentionally not semantic AI decomposition and does not execute the plan. It reads
only a small root-level allowlist; it does not crawl source trees, run repository
commands, contact providers, inspect credentials, authorize effects, or claim that
the proposed task is sufficient for implementation. Those capabilities require
separate reviewable contracts and evidence boundaries.
