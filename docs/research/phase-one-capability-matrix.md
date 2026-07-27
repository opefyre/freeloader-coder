# Phase-one capability matrix

Every Guided Alpha capability must serve a validated job and address a known
failure trigger.

| Capability | Primary job | Evidence | Failure trigger | Required product response |
|---|---|---|---|---|
| Clone-based setup | Start without designing infrastructure | O-001 | Multi-service manual setup | Preflight, one canonical start command, exact remediation |
| Repository onboarding | Understand an existing project safely | O-001, E-003 | Agent invents conventions or edits wrong paths | Grounding summary, protected paths, explicit uncertainty |
| Free-provider connections | Use available models without surprise cost | O-001, E-004 | Quota exhaustion or accidental paid fallback | Zero-cost default, visible quota state, opt-in budget only |
| Conversational request | Express desired outcome naturally | O-001, E-002 | Prompt treated as executable specification | Clarify only material ambiguity, generate reviewable plan |
| Readiness and decomposition | Make work small and dependency-safe | O-001, E-003 | Oversized task or overlapping file ownership | Deterministic readiness checks and validated task graph |
| Grounding contract | Preserve product and repository conventions | O-001 | Models invent styles, APIs, or architecture | Shared versioned grounding supplied to every model stage |
| Isolated execution | Protect the user’s working branch | O-001 | Partial or unsafe changes contaminate the repository | Worktree isolation, checkpoints, protected-path policy |
| Deterministic validation | Prove observable postconditions | O-001, E-001, E-003 | Model claims completion without proof | Typecheck, lint, tests, build, functional checks, artifacts |
| Independent review | Catch plausible but wrong changes | E-001, E-003 | Same model validates its own assumptions | Independent functional and design review with quorum |
| Healing and retry | Continue through routine failure | O-001 | Provider, patch, or transient validation failure | Classified retry budget, fallback, context-aware repair |
| Control Center | Understand progress and act | O-001 | Text-heavy dashboard or conflicting state | Canonical live state, evidence links, pause/retry/inspect |
| Human escalation | Resolve decisions automation cannot own | O-001 | Generic “needs user” with no next action | Exact blocker, safe state, recommended and alternate action |
| Backup and restore | Recover interrupted or incorrect work | O-001 | Restart loses progress or corrupts state | Event replay, snapshots, restore preview, verified rollback |

## Critical-decision ownership

| Decision | Default owner | Automation may do | Automation must not do |
|---|---|---|---|
| Paid usage | User | Estimate and recommend | Enable billing or exceed zero budget |
| Secret access | User policy | Request minimum scoped secret | Copy secrets into prompts, logs, or repository |
| Destructive Git action | User | Prepare reversible alternative | Rewrite or delete user work without approval |
| Product ambiguity | User | Present bounded options and consequences | Invent policy or requirements |
| Routine provider failure | System | Retry, route, back off, preserve work | Quarantine on the first transient failure |
| Validation failure | System | Diagnose and attempt bounded healing | Claim success or bypass the failed gate |
| Publish/merge | User policy | Prepare branch, commit, or draft PR | Publish when policy requires review |

