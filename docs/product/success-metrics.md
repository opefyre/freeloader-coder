# Success metrics and guardrails

Version: 1.0  
Owner: Product  
Jira: [PIPE-25](https://opefyre.atlassian.net/browse/PIPE-25)

## North-star outcome

A target user reaches a validated, reviewable change while retaining control of
cost, data, Git history, and publication.

“Validated” requires deterministic evidence. A model response, generated patch,
attempted command, or provider acknowledgement does not qualify.

## Activation funnel

| Stage | Event | Success definition | Failure owner |
|---|---|---|---|
| Repository cloned | `setup_started` | Supported source checkout recognized | Setup |
| Preflight passed | `preflight_completed` | Runtime, Git, storage, and validator requirements pass | Runtime |
| Project opened | `project_opened` | Repository boundary and baseline commit recorded | Onboarding |
| Provider ready | `provider_check_completed` | At least one eligible zero-cost route passes a bounded canary | Provider |
| Request accepted | `request_accepted` | Intent stored with privacy and permission policy | Chat |
| Plan ready | `plan_validated` | Grounded, dependency-safe graph accepted | Orchestration |
| Change applied | `change_applied` | Patch applies inside isolated worktree | Execution |
| Checks passed | `validation_completed` | Required deterministic checks pass | Validation |
| Review ready | `review_ready` | Independent review and evidence bundle complete | Quality |
| Change kept | `change_kept` | User or policy accepts commit/branch | Git |

The primary activation metric is the percentage of eligible new local
installations reaching `review_ready` within one continuous seven-day window.

## Initial targets

Foundation targets are hypotheses and must be recalibrated after the first ten
external sessions.

| Metric | Guided Alpha target | Connected Beta target | Owner | Review |
|---|---:|---:|---|---|
| Preflight completion | ≥80% | ≥90% | Runtime | Weekly |
| Provider-ready rate | ≥75% | ≥90% | Providers | Weekly |
| Request-to-valid-plan | ≥85% | ≥92% | Orchestration | Weekly |
| Plan-to-review-ready | ≥60% | ≥80% | Execution/Quality | Weekly |
| Median first validated change | ≤45 min | ≤25 min | Product | Weekly |
| Routine failure auto-recovery | ≥70% | ≥90% | Reliability | Weekly |
| Recovery explanation correctness | ≥90% | ≥95% | Product/Reliability | Per study |
| False-completion rate | 0 | 0 | Quality | Every release |
| Surprise-cost incidents | 0 | 0 | Providers/Security | Continuous |
| Credential exposure incidents | 0 | 0 | Security | Continuous |
| Unrecoverable user-work loss | 0 | 0 | Storage/Git | Continuous |

## Trust and reliability measures

- **False completion:** UI or notification says completed, fixed, safe, kept, or
  published without its required postcondition.
- **Correction rate:** accepted changes later rejected because the product
  omitted known evidence or misrepresented state.
- **Restore success:** restore attempts whose resulting repository and canonical
  task state match the selected checkpoint.
- **Recovery success:** interrupted tasks returning to a valid actionable stage
  without duplicate external effects or lost verified work.
- **Quota block quality:** quota-exhausted sessions that preserve work and show
  a correct reset/fallback/manual option.
- **User intervention burden:** material decisions or repair actions required per
  review-ready change.
- **State disagreement:** any dashboard, notification, connector, or API
  projection disagreeing with canonical task state.

## Privacy-safe event properties

Allowed by default:

- Schema version
- Installation-scoped random identifier
- Release channel and application version
- Operating-system family and coarse resource profile
- Stage and normalized outcome
- Duration bucket
- Error class and owning component
- Retry count and recovery strategy
- Provider identifier and model family when user policy permits
- Boolean indicators for offline, quota blocked, restored, or user intervention

Forbidden by default:

- Prompts or model outputs
- Source code, diffs, filenames, or full paths
- Repository, branch, commit, issue, account, person, organization, or project
  names
- Credentials, tokens, headers, cookies, or environment values
- Attachments, screenshots, terminal output, or support bundles
- IP addresses or stable hardware identifiers
- Free-form error text

Unknown properties are rejected rather than silently recorded.

## Cohorts

- First local run vs returning installation
- Standard vs Advanced presentation
- Supported OS family
- 8 GB low-resource profile vs standard resource profile
- Offline-only vs external free-provider route
- Guided Alpha vs Connected Beta release channel

Small cohorts are suppressed from shared analytics. Local diagnostics remain
available without transmission.

