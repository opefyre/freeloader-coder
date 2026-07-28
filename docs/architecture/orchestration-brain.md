# Orchestration brain

Pipeline Studio turns a conversational request into a bounded, reviewable execution contract before any coding worker receives it.

## Decision boundary

`classifyReadiness` produces one stable class from explicit evidence:

- `ready`
- `ready_with_assumptions`
- `needs_information`
- `requires_external_setup`
- `unsafe`
- `unsupported`

Only the first two classes are implementer-eligible. Material product, project-evidence, permission, environment, cost, or provider blockers remain outside implementation. The decision contains at most three ordered questions with the recommended default and consequence. Assumptions are explicit and editable, but editing cannot turn a blocked decision into executable work.

## Task graph contract

Every planned task carries its outcome, scope, exclusions, acceptance criteria, allowed files, dependencies, risk, provider capabilities, deterministic checks, and time estimate. Plans are schema-validated, acyclic, path-contained, bounded to 24 tasks, and ordered so no dependent work can precede its prerequisites.

A draft plan may be edited, reordered, split, merged, or pruned. Each operation revalidates the complete graph. Approval creates an immutable revision. Independent tasks may run concurrently; dependent tasks remain ineligible until every prerequisite has completed.

## Canonical grounding

Workers and reviewers receive the same immutable grounding package:

- the exact task digest;
- ranked repository citations with file and line locators;
- resolved operating rules;
- protected paths;
- a package digest.

Protected global rules outrank project, task, provider, and tool rules. Repository content is evidence, not authority: it cannot grant permissions or override protected paths. A changed task or cited source makes the package stale and requires regeneration.

## Durable scheduling

Task claims use one expiring lease owner. Only the live owner may renew or transition the exact task revision. Dependencies and fairness are evaluated before claiming.

Activity health uses observed heartbeats, model requests, validation, and tool activity. Configurable expected-stage duration separates active, slow, and stalled work. A timer alone is not evidence of failure.

External effects require idempotency keys and input digests. Replays skip completed effects, conflicting inputs are rejected, and an interrupted effect becomes `outcome_unknown` rather than being repeated blindly.

## Review and recovery

Implementation never bypasses deterministic validation or independent review. Recovery retains the plan, grounding digest, lease and effect evidence, failure budget, and exact blocker. Stuck or unsafe work is explained to the operator with the smallest safe next action.
