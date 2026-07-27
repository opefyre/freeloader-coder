# PIPE-31 — Generalized Pipeline Core Migration Evidence

## Outcome

The proven control behaviors from the Household prototype have been extracted
into a separate, product-neutral Pipeline Studio core. No Household runtime,
application source, live state, credential, or machine-specific service is a
dependency of this implementation.

## Acceptance criteria

### AC1 — Retained behaviors have regression coverage

Passed. The complete mapping is maintained in
`docs/migration/parity-matrix.md`. It covers workflow stages, readiness,
decomposition, grounding, leases, idempotent effects, retry classification,
strict model results, repository scope, worktree isolation, deterministic
validation, healing, review quorum, provider routing, free-tier quotas,
circuits, cache behavior, integration gating, and post-integration validation.

### AC2 — A one-computer journey completes without remote dependencies

Passed. `tests/single-machine-migration.e2e.test.ts` exercises a complete
synthetic journey with:

- temporary local workspace and scoped edits;
- deterministic grounding and validation;
- fake local provider responses;
- lease and idempotent-effect coordination;
- two independent reviews;
- guarded commit, integration, and post-integration validation;
- observed evidence before `REVIEW_READY`.

The test performs no provider, connector, Jira, GitHub, daemon, Docker, or
internet call.

### AC3 — Migration changes and rollback are documented

Passed. The source inventory, generalized target architecture, parity matrix,
deliberate exclusions, and rollback boundary are in `docs/migration/`.
Rollback is confined to reverting Pipeline Studio commits.

## Verification

The repository verification gate runs:

1. local setup checks;
2. formatting rules;
3. repository safety lint;
4. strict TypeScript type checking;
5. a clean build;
6. all offline contract, parity, safety, and end-to-end tests.

At completion, all 40 tests pass with no failures.

## Trust boundary and remaining work

This ticket proves the generalized core and its contracts. It does not claim
that durable database adapters, live Git operations, provider onboarding,
operator UI, or always-on runtime packaging are complete. Those remain
independently reviewable Pipeline Studio tickets and must pass their own
acceptance gates.
