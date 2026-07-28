# Pipeline Core Migration Parity Matrix

This matrix is the review contract for extracting the proven Household pipeline
behaviors into Pipeline Studio. It maps every retained behavior to generalized
implementation and executable evidence. Household-specific names, paths,
credentials, services, and operational state are deliberately excluded.

Source snapshot reviewed: `de77c93c4016d452bb10fa0489f4457e5c2508d2`

| Retained behavior | Generalized implementation | Executable evidence |
| --- | --- | --- |
| Durable, explicit workflow stages | `packages/orchestration/src/workflow.ts` | `tests/workflow-parity.test.ts` |
| Readiness classification before decomposition | `packages/orchestration/src/readiness.ts` | `tests/readiness-grounding-parity.test.ts` |
| Bounded, acyclic task graphs | `packages/orchestration/src/readiness.ts` | `tests/readiness-grounding-parity.test.ts` |
| Deterministic grounding bundle | `packages/orchestration/src/grounding.ts` | `tests/readiness-grounding-parity.test.ts` |
| Single active lease with expiry | `packages/storage/src/coordination.ts` | `tests/coordination-review-parity.test.ts` |
| Idempotent external effects and uncertain-outcome safety | `packages/storage/src/coordination.ts` | `tests/coordination-review-parity.test.ts` |
| Bounded, classified retry behavior | `packages/orchestration/src/retry.ts` | `tests/model-result-retry-parity.test.ts` |
| Strict versioned boundary schemas | `packages/schemas/src/index.ts` | `tests/schema-contract.test.ts` |
| Strict plan, implementation, and review outputs | `packages/schemas/src/index.ts` | `tests/model-result-retry-parity.test.ts` |
| Scoped repository access | `packages/tools/src/repository.ts` | `tests/repository-safety-parity.test.ts` |
| Stale-input and symbolic-link protection | `packages/tools/src/repository.ts` | `tests/repository-safety-parity.test.ts` |
| Isolated worktree preparation with postcondition checks | `packages/tools/src/repository.ts` | `tests/repository-safety-parity.test.ts` |
| Tiered deterministic validation | `packages/validation/src/runner.ts` | `tests/validation-cache-circuit-parity.test.ts` |
| Redacted validation evidence and input fingerprints | `packages/validation/src/runner.ts` | `tests/validation-cache-circuit-parity.test.ts` |
| Bounded healing and truthful terminal states | `packages/orchestration/src/workflow.ts` | `tests/workflow-parity.test.ts` |
| Independent two-reviewer quorum with dissent preservation | `packages/orchestration/src/reviews.ts` | `tests/coordination-review-parity.test.ts` |
| Privacy, cost, capability, quota, and circuit-aware routing | `packages/providers/src/router.ts` | `tests/provider-routing-parity.test.ts` |
| Daily free-tier quota accounting | `packages/providers/src/circuit.ts` | `tests/validation-cache-circuit-parity.test.ts` |
| Scheduled free-provider admission, safe concurrency, and protected QA capacity | `packages/orchestration/src/provider-scheduler.ts` | `tests/provider-scheduler.test.ts`, `tests/provider-routing-parity.test.ts` |
| Verified free-provider catalog and permanent-free admission boundary | `packages/providers/src/catalog.ts` | `tests/provider-catalog.test.ts` |
| Transient-failure circuit breaking | `packages/providers/src/circuit.ts` | `tests/validation-cache-circuit-parity.test.ts` |
| Scoped, expiring, bounded, unverified result cache | `packages/providers/src/cache.ts` | `tests/validation-cache-circuit-parity.test.ts` |
| Commit/integration only after validation and review | `packages/orchestration/src/workflow.ts` | `tests/workflow-parity.test.ts` |
| Post-integration validation before review-ready | `packages/orchestration/src/workflow.ts` | `tests/workflow-parity.test.ts` |
| Complete single-machine control journey | All packages above, using injected local adapters | `tests/single-machine-migration.e2e.test.ts` |

## Deliberate exclusions

- No Household task database, live service, token, path, Jira state, provider
  account, or deployment configuration is copied.
- The end-to-end proof uses temporary local files, fake providers, and injected
  adapters. It proves orchestration contracts and safety behavior without
  claiming production connector or daemon readiness.
- Durable database adapters, live Git execution, provider OAuth/key setup,
  operator UI, and background runtime packaging remain separate Pipeline
  Studio delivery work.

## Rollback boundary

The migration is additive in this repository. Rollback is a Git revert of the
migration commits. It does not require or authorize any mutation of the
Household repository or its running pipeline.
