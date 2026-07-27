# Personas and jobs

## Primary persona — the GitHub-capable vibecoder

Can:

- Clone and navigate a repository.
- Run a small number of documented commands.
- Add an API key through a settings screen or local secret prompt.
- Read a concise diff, build result, screenshot, and test failure.
- Understand branch, commit, pull request, issue, API key, and build.

Should not be expected to:

- Design a multi-agent architecture.
- Diagnose a process manager, lease, queue, or circuit breaker.
- Select models based on context windows and provider-specific limits.
- Repair partial task graphs, patch anchors, or event replay.
- Understand OAuth brokers, reverse proxies, container networking, or database
  recovery before first success.

Top jobs:

1. “Take this product request and turn it into safe, reviewable work.”
2. “Keep making progress without requiring me to supervise every model call.”
3. “Use free capacity first and never surprise me with a charge.”
4. “Show me what actually changed and whether it works.”
5. “Recover routine failures yourself; explain the rest in plain language.”
6. “Keep the result integrated with the existing repository and design.”
7. “Let me intervene, redirect, pause, retry, or reject without corrupting work.”

Trust fears:

- The agent changed more than requested.
- A model invented APIs, requirements, or completion evidence.
- A retry duplicated an external action.
- Private source, credentials, or personal data left the machine.
- Free-tier exhaustion silently switched to a paid provider.
- A “fix” passed shallow checks but broke the actual user journey.
- The product is stuck while reporting that it is healthy.

## Secondary persona — technical solo builder

Has deeper Git, runtime, and debugging knowledge but limited time. Wants strong
defaults and automation while retaining raw logs, task graphs, model routing,
worktrees, and policy controls.

Top jobs:

- Run multiple bounded tasks without losing architectural consistency.
- Inspect or override a decision without forking canonical state.
- Export complete evidence for a pull request or incident.
- Add custom tools and providers behind explicit permissions.

## Tertiary persona — open-source maintainer

Needs reproducible contributor setup, stable contracts, compatibility policy,
safe updates, issue evidence, and a supportable plugin boundary.

## Excluded initial personas

- A person who has never used Git or a terminal.
- A regulated enterprise requiring centralized identity and fleet policy.
- A team expecting the product to publish unreviewed changes directly to
  production.

Exclusion is a sequencing decision, not a judgment of user value.

