# PIPE-46 — Permissions, connections, and consent settings

## Outcome

Settings now provides a plain-language permissions workspace alongside the existing provider connections. It exposes the system's actual consent surfaces without revealing credentials or sensitive local metadata.

## Acceptance evidence

- Permission catalogue covers project folders, providers, connectors, tools, external effects, and paid actions.
- Each permission shows its project, target, allowed effect, expiry, current state, recent use, and optional technical scopes.
- Guided, Balanced, and Autonomous postures are selectable and explain their automation boundary.
- Users can revoke immediately, expire in 24 hours, or restore the recommended setting.
- Revocation visibly blocks new work and explains how active work will pause or reconcile safely.
- Privacy screen masks project names, local targets, connector details, and external service metadata while preserving the canonical in-memory values.
- Paid use remains denied and the connections view retains the `$0.00` denial-of-wallet policy.
- Controls use tabs, pressed states, labels, and an `aria-live` outcome message.

## Interactive acceptance

Verified in the running Studio preview:

1. The Permissions tab rendered all six consent surfaces and the three approval presets.
2. Privacy screen replaced project and service targets with masked, screen-safe labels.
3. `Revoke now` changed the selected permission to Revoked, disabled repeated revocation, blocked new work, and reported the safe active-work action.
4. `Reset to recommended` restored the permission.
5. The Connections tab retained Groq, Cloudflare Workers AI, Gemini, OpenRouter, GitHub Models, and candidate provider states plus dashboard and Jira links.

## Verification

- `tests/permission-settings.test.ts`: catalogue, revoke, expiry, reset, privacy, and paid-denial behavior.
- `tests/studio-workspace-contract.test.ts`: required UI language, controls, categories, and accessibility hooks.
- Full repository verification: 141 tests passed, 0 failed.
- Type checks passed.
- Studio production build passed.
- `git diff --check` passed.

