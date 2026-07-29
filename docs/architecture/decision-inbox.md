# Decision Inbox

## Purpose

The Decision Inbox answers one operational question: **what is waiting for a
person, provider, policy, project repair, or recovery step right now?** It is a
read-only projection of canonical local evidence, not a second task database
and not an approval engine.

## Inputs and authority

The decision engine reads bounded Live Operations and Autonomy snapshots. It
does not call providers, mutate requests, approve effects, retry work, or write
to external systems. Each row exposes its authority boundary and links to the
canonical surface where the user can inspect or act.

Inputs include request and run observations, project warnings, provider
connection state, autonomy recommendations, expired coordinator leases, and
failed or blocked coordinator receipts. Healthy and terminal observations do
not create synthetic decisions.

## Determinism

Categories, priority, owner, age, state, cost, reversibility, and reference are
derived by deterministic rules. Stable SHA-derived identities and
conflict-detecting deduplication make refreshes replay-safe. Ordering is
priority, overdue status, newest observation, then stable identity.

Unknown future observations do not become high-confidence blockers. They are
ignored unless they match a canonical attention state; unknown priority cases
fall to the lowest justified level.

## Privacy and retention

Credentials, tokens, prompts, source content, personal paths, provider bodies,
and sensitive values are excluded or redacted. The control plane is loopback
only, responses are bounded, and browser credentials are omitted. Exports are
created locally from displayed redacted items.

The queue is explicitly `bounded_current_state`, with at most 250 items. It
does not claim unlimited history or imply that an absent decision was resolved.

## User experience

`/decisions` offers summary metrics, time ranges, category/priority/owner/age
facets, bounded search, four priority lanes, a complete decision inspector,
canonical cross-links, local export, and explicit loading, all-clear,
filtered-empty, stale, and offline states. Desktop and mobile navigation,
keyboard operation, reduced-motion compatibility, visible focus, and light/dark
themes use the shared Studio design system.
