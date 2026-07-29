# Sprint 20 paid-safety evidence

Scope: PIPE-113–116 and PIPE-174–177.

## Observable decision

The repository contains disabled, keyless contracts for OpenAI API, Anthropic
API, and Codex execution. There is no configured credential, live request,
billing activation, or paid route.

| Claim | Executable evidence | Negative fixture |
| --- | --- | --- |
| Exact hard budgets and emergency shutdown | `tests/paid-budget-policy.test.ts` | Missing, mismatched, expired, revoked, over-budget, or emergency-disabled authorization |
| OpenAI/Anthropic request admission | `tests/optional-paid-providers.test.ts` | Unconfigured connection, absent vault reference, missing budget |
| Codex worker safety | `tests/codex-worker.test.ts` | Disconnected login or copied browser/session credential |
| Billing/auth separation and operator controls | `tests/studio-optional-provider-center.test.ts` | No activation control; simulator proves local denial |

Reproduce with:

```sh
npm run verify
npm run studio:build
```

## Verification result

- `npm run verify`: 427/427 tests passed, including the disabled-provider,
  hard-budget, emergency-shutdown, privacy-safe usage, Codex worker, and UI
  contracts.
- `npm run studio:build`: passed. The build reports the existing large-chunk
  advisory; it does not block or alter runtime behavior.
- Browser audit at `/providers`: OpenAI API, Codex worker, and Anthropic API
  selection all render as `Off` and `Not configured`; no activation control is
  present.
- Safety simulator: default denial, hard-budget denial, and emergency shutdown
  each rendered the expected operator state.
- Dark and light themes: visually inspected at the standard 1280px viewport.
- Responsive audit: 390px viewport rendered without horizontal overflow.
- Source evidence: selected provider official documentation and Jira links
  exposed the expected destinations.
- Runtime diagnostics: zero browser console warnings/errors and zero horizontal
  overflow in both audited viewport sizes.
- Billing evidence: `$0 spent`, `0 paid calls`, no credentials created, no live
  provider request made, and no billing route enabled.
