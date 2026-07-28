# PIPE-178 provider admission foundation

Date: 2026-07-28

## Delivered slice

- Versioned, strict provider connection, cost, quota, and canary evidence schemas.
- Vault-reference-only credential boundary; provider keys cannot be serialized into a connection record.
- Deterministic admission checks for connection state, credential state, verified endpoint/model, permanent-free eligibility, billing state, evidence freshness, live canary, and required capabilities.
- Candidate construction from current account evidence, including provider remaining capacity and a protected review reserve.
- A bounded OpenAI-compatible chat canary with timeout, cancellation, minimum output, safe status classification, and no raw provider-error propagation.
- Explicit denial of promotional-credit and billing-enabled connections from permanent free-only routing.
- Interactive Studio connection inspector with provider dashboards, official free-tier evidence, Jira implementation tickets, admission steps, and an honest DeepSeek credit-only state.

## Security and privacy evidence

- Credential records accept only `vault:` references and a one-way short fingerprint.
- The live canary receives a credential only as a transient function argument.
- Canary output stores token counts, model identity, capability, freshness, and a safe status; it does not store prompts, response text, response bodies, or credentials.
- HTTP failures are reduced to bounded safe classifications.
- Secret scanning, strict-schema tests, and unknown-field rejection are part of the repository verification.

## Cost evidence

- Permanent free routing requires current cost evidence with `zeroCost: true` and `billingEnabled: false`.
- Only `permanent_free` and `account_limited_free` access classes are eligible.
- DeepSeek promotional balance remains ineligible for permanent free routing.
- Stale cost, quota, or canary evidence removes a connection from admission.

## Verification

- Full repository setup, formatting, lint, type checking, and tests pass.
- Provider connection tests cover embedded-secret rejection, evidence freshness, capability admission, account quota projection, promotional-credit denial, billing denial, bounded canary requests, and safe rate-limit errors.
- Studio production build passes.
- Browser review confirms selectable provider rows, provider-specific setup evidence, live Jira/source links, and no console errors.

## Remaining work before PIPE-178 can close

- Implement the approved OS credential-vault adapter and credential lifecycle persistence.
- Add provider-specific cost/plan and quota probes where the API exposes them.
- Add structured-output and tool-calling canaries.
- Add a server-side connection workflow, encrypted persistence, revoke/disconnect effects, and end-to-end recovery tests.
- Connect the resulting admitted candidates to the production scheduler rather than the Studio fixture.
