# Evidence register

## Direct observational evidence

### O-001 — Continuing GitHub-capable builder workflow

Method: longitudinal observation of a builder configuring and supervising an
autonomous coding pipeline.

Observed capabilities:

- Can clone repositories, use GitHub and Jira, add API keys, run documented
  terminal commands, and interpret diffs and test results.
- Does not want to diagnose leases, process managers, provider protocol
  mismatches, retry loops, or machine routing.
- Accepts slow free-tier execution when visible progress and truthful state are
  available.
- Expects automation to recover from routine provider and patch failures.
- Wants exact blockers and actionable options when recovery requires a person.
- Loses trust quickly when a dashboard, Jira, and the underlying task database
  disagree.
- Rejects invisible waiting, repeated status reporting without repair, and
  generic explanations.
- Wants the work to preserve the existing product design rather than inventing
  unrelated styles.

Observed abandonment triggers:

1. Repeated “healthy” reports without an observable task-stage change.
2. A task shown as running when no worker or live lease exists.
3. Local compute unexpectedly freezing the primary computer.
4. Incorrect account/profile selection for external integrations.
5. Provider capacity failures converted into permanent task failures.
6. Model output treated as applied or completed before patch and validation
   evidence exists.
7. Setup instructions that require understanding infrastructure rather than
   completing a bounded action.
8. A monitoring surface that contains large amounts of text but few useful
   actions, links, or evidence.

Product implication: reliability is the interaction design. Recovery,
provenance, and truthful state cannot be “advanced observability” added later.

## Published evidence

### E-001 — AI adoption is high while trust remains low

The 2025 Stack Overflow Developer Survey reports widespread AI-tool use while
accuracy, security, and privacy remain major concerns. The AI results report
31,636 responses for the cited section and show that distrust is not a niche
edge case.

Source:
[Stack Overflow Developer Survey 2025 — AI](https://survey.stackoverflow.co/2025/ai)

Implication: generated code must arrive with evidence and reversible review,
not confidence language.

### E-002 — Developers value relief from repetitive work

GitHub’s developer-experience research reports that developers expect AI coding
tools to improve productivity and preserve mental effort, particularly around
repetitive work.

Sources:

- [GitHub — Survey reveals AI’s impact on the developer experience](https://github.blog/news-insights/research/survey-reveals-ais-impact-on-the-developer-experience/)
- [GitHub — The AI wave continues to grow on software-development teams](https://github.blog/news-insights/research/survey-ai-wave-grows/)

Implication: the product should automate coordination, retries, checks,
evidence collection, and repetitive Git operations—not merely generate more
code for the user to sort out.

### E-003 — AI benefits depend on delivery-system quality

Google Cloud’s DORA research connects AI adoption with broader delivery-system
effects and emphasizes the surrounding practices that determine whether local
productivity becomes reliable software delivery.

Source:
[DORA 2024 Accelerate State of DevOps report](https://dora.dev/research/2024/dora-report/2024-dora-accelerate-state-of-devops-report.pdf)

Implication: task completion must be defined by deterministic validation,
review, integration, and recovery rather than model output.

### E-004 — AI assistance is becoming normal across tools

JetBrains’ developer research shows broad and increasing use of AI tooling
across a large international developer sample.

Sources:

- [JetBrains State of Developer Ecosystem 2025](https://devecosystem-2025.jetbrains.com/)
- [JetBrains research reports](https://www.jetbrains.com/resources/industry-reports/)

Implication: provider choice should be modular. The product’s durable advantage
must be orchestration, trust, and recovery rather than attachment to one model.

## Evidence-to-decision rules

- One observed failure may justify a safety guardrail when the downside is
  credential loss, paid use, data loss, permission escalation, or false
  completion.
- Convenience decisions require repeated observation or usability evidence.
- Market claims require external participants; the founder workflow alone is
  insufficient.
- Provider claims require reproducible canaries and dated compatibility
  evidence.

