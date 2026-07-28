# PIPE-57 — Task decomposition evidence

- Domain: `packages/orchestration/src/task-planner.ts`
- Graph validation: `packages/orchestration/src/readiness.ts`
- Interactive proof: `/work`, “Dependency-aware task plan”
- Automated proof: `tests/orchestration-task-planner.test.ts`

The draft supports edit, reorder, split, merge, and remove. Every operation revalidates identities, bounds, paths, cycles, dependency order, and complete task contracts. Approval freezes the plan.
