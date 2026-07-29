# Optional paid-provider architecture

OpenAI API, Anthropic API, and Codex execution are optional and disabled by
default. This implementation installs typed boundaries and offline fixtures;
it does not create credentials, enable billing, or send a provider request.

## Distinct integrations

- **OpenAI API** uses a vault-only API-key reference and the Responses API
  request shape. API billing is separate from ChatGPT or Codex subscriptions.
  Requests set provider-side storage to false.
- **Anthropic API** uses a vault-only API-key reference and the Messages API
  request shape. Anthropic Console/API billing is separate from consumer Claude
  plans.
- **Codex worker** uses supported Codex login through the app-server or SDK
  boundary. It never copies browser sessions or undocumented credentials.
  Threads, turns, approvals, sandbox rules, tools, streamed events, and
  authentication remain distinct from generic provider calls.

## Required gates

A paid API call is impossible until all of these agree:

1. exact provider connection and vault reference;
2. exact project, model, and role;
3. per-request, per-task, daily, and monthly hard budgets;
4. live, unrevoked, unexpired authorization;
5. matching final-confirmation digest;
6. emergency shutdown is off.

Budget exhaustion stops locally and cannot fall through to another paid
provider. Usage evidence records provider, model, project, task, purpose,
estimate, actual cost when available, and token totals without prompt content.

Codex output remains unverified until local deterministic validation and at
least two independent review roles pass. Provider or executor completion cannot
bypass permissions, sandboxing, evidence, or review.

## Sources

- [OpenAI Responses API guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Codex app-server guidance](https://learn.chatgpt.com/docs/app-server)
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
