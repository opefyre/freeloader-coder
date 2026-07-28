# PIPE-178 provider admission foundation

Date: 2026-07-28

## Outcome

Pipeline Studio now treats catalog presence, connection state, and execution readiness as separate facts. A provider reaches free-only scheduling only after current credential, endpoint, model, capability, quota, and zero-cost evidence passes the shared admission policy.

## Delivered

- Extended the strict provider connection contract with privacy class, capability roles, context/output limits, account quota evidence, cost evidence, canary freshness, credential reference/fingerprint, and revocation state.
- Added a vault-bound connection lifecycle for connect, re-probe, model replacement, revoke, and disconnect. The repository receives only a `vault:` reference and one-way fingerprint.
- Added bounded OpenAI-compatible chat, structured-output, and tool-calling canaries with cancellation, timeout, token usage, strict sentinel validation, and sanitized failures.
- Added safe repair guidance for invalid keys, wrong projects/regions, unavailable models/endpoints, unsupported schemas/tools, and ineligible credit.
- Added account response-header quota discovery with short freshness windows and conservative documented fallback. Account-observed values override catalog documentation.
- Added cost evidence derived from verified catalog access plus account billing state. Billing-enabled, unknown-cost, and promotional-credit-only routes are excluded from permanent free routing.
- Added atomic private JSON persistence for masked connection evidence. Restart re-probe resolves the key through the vault reference without serializing the key.
- Added core runtime admission wiring. Stale or failed connections are held before an execution journal or model call is created, preserving queued work and retry budgets.
- Added Standard UI guidance and expandable Advanced sanitized evidence for credential, canary, quota, and routing state.

## Acceptance evidence

- Shared adapter/lifecycle path supports Cerebras, Mistral, Zhipu AI, and SambaNova without provider-specific secret handling.
- `resolveAdmittedProviderCandidates` is the only conversion from a connection record into a runnable free candidate.
- Stale canary, stale quota, stale cost, revoked credential, model/endpoint mismatch, unproven capability, billing enabled, and promotional credit all remove a route from admission.
- Account response-header limits override documented defaults and carry source, observation, expiry, remaining capacity, and reset timestamps.
- Runtime-measured consumption remains separate in `ProviderCapacityUsage`; provider-reported remaining capacity feeds the existing quota-reset scheduler.
- DeepSeek promotional credit remains visible for an explicit separate policy but cannot silently enter permanent free routing.

## Security and privacy

- Secrets are transient arguments to the vault and probe boundary only.
- Connection JSON, compatibility evidence, test output, UI, and Jira evidence contain no keys or full account identifiers.
- Provider bodies, prompts, complete outputs, and raw response headers are not persisted by admission.
- Persistence uses strict schemas, private file modes, atomic replacement, and unknown-field rejection.
- Paid use remains impossible through the default free-only cost policy.

## Verification

- `npm run verify`: setup, formatting, lint, type checking, build, and all 128 automated tests passed.
- `npm run studio:build`: production Studio bundle passed.
- Automated coverage includes schema rejection, secret redaction, all four provider contracts, chat/structured/tool canaries, cancellation, timeout, account quota precedence, promotional-credit denial, stale-evidence queue preservation, restart re-probe, atomic persistence, revoke/disconnect, quota-reset deferral, circuits, and core admission holds.
- Failed initial probes erase the newly supplied vault value and replace raw provider errors with bounded repair guidance.
- Rendered browser acceptance confirmed:
  - Standard setup state explains the three required admission steps.
  - Advanced evidence expands by keyboard/click and exposes only sanitized facts.
  - DeepSeek explicitly displays “Excluded from permanent free.”
  - Provider dashboard, official evidence, and Jira ticket links are actionable.
  - The rendered page has no admission-control console or navigation failure.

## Dependency boundary

PIPE-178 consumes the credential-vault contract. Native macOS Keychain, Windows Credential Manager, Linux Secret Service, and encrypted-fallback implementations remain owned by PIPE-43; no provider adapter can bypass that boundary.
