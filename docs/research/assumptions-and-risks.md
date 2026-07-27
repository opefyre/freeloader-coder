# Rejected assumptions and open risks

## Rejected assumptions

### “Vibecoder” means technically illiterate

Rejected. The target user understands GitHub concepts and can run documented
commands. Removing all technical language would make evidence less trustworthy.

### More autonomy means fewer visible states

Rejected. Higher autonomy requires better visibility into outcomes, recovery,
cost, and exceptions—not a permanently animated “working” indicator.

### Diffs and logs are insufficient review experiences

Rejected as a universal claim. For the target audience, concise diffs and test
logs are sufficient baseline evidence. Screenshots, journey replays, and
structured summaries are valuable enhancements when the task benefits from
them.

### The strongest model should handle every stage

Rejected. Routing should consider task role, capability, privacy, quota,
latency, and independent-review requirements.

### Provider fallback equals reliability

Rejected. Reliability also requires durable state, bounded retries, safe patch
application, deterministic validation, recovery, and truthful escalation.

### “Free tier first” can be a routing preference

Rejected. It is a hard cost policy. Paid routes are ineligible until the user
explicitly enables a budget.

## Open risks

| Risk | Current judgment | Required follow-up |
|---|---|---|
| Founder workflow overfits product design | High | Five external Guided Alpha usability sessions |
| Windows setup differs materially from macOS | High | Clean Windows/WSL setup canary |
| Free provider limits change without notice | High | Dated compatibility canaries and circuit policy |
| Local containers overwhelm low-memory machines | Medium | 8 GB resource profile and adaptive concurrency |
| Users misunderstand “ready to review” as “safe to publish” | High | Comprehension test and explicit publish boundary |
| OAuth availability differs across providers | Medium | API-key fallback with scoped setup guidance |
| Plugin ecosystem expands permission risk | High | Signed manifest, capability policy, isolated execution |
| Screenshots expose personal/project data | Medium | Synthetic fixtures and redaction before attachment |

## Release-blocking unknowns

- Whether setup and first validated change can be completed by an external
  target user without live maintainer assistance.
- Whether recovery language produces the correct user choice in interrupted,
  permission-denied, and quota-exhausted scenarios.
- Whether zero-budget enforcement holds across every provider adapter and
  retry/fallback route.

