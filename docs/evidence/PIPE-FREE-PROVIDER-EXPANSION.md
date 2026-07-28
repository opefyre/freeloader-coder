# Free-provider expansion

Verified on 2026-07-28 against official provider documentation and, for
Cerebras, the account-specific Limits page.

## Admission decision

| Provider | Decision | Reason |
| --- | --- | --- |
| Cerebras | Admit after API-key canary | Permanent $0 tier; account limits observed directly |
| Mistral | Admit after API-key and limits canary | Free mode needs no credit card; limits are organization-specific |
| Zhipu AI | Admit only Flash models after canary | GLM-4.7-Flash and GLM-4-Flash are explicitly free |
| SambaNova | Admit after API-key canary | No-payment-method accounts receive a documented free tier |
| DeepSeek Platform | Exclude from automatic free routing | Token-priced; granted balance is temporary promotional credit |

## Observed Cerebras limits

The logged-in organization exposed `gpt-oss-120b`, `zai-glm-4.7`, and
`gemma-4-31b`. Each showed 5 requests/minute, 2,400 requests/day,
30,000 tokens/minute, and 1,000,000 tokens/day. The production
`gpt-oss-120b` route showed a 131,000-token context and 40,000-token maximum
completion.

Account-observed limits override generic documentation because Cerebras states
that precise limits can vary by organization.

## Routing safeguards

- A catalog entry is not an active route.
- API-key presence, model discovery, free/billing state, account limits, and a
  bounded canary must all succeed before `configured` becomes true.
- Unknown limits are provider-reported and learned from response headers.
- Review capacity remains reserved when a provider publishes a daily request
  allowance.
- DeepSeek promotional balance can be displayed, but it cannot be selected by
  the free-only router.
- A 402, billing-enabled state, missing free model, or unknown cost disables
  automatic admission.

## Official sources

- Cerebras:
  - <https://inference-docs.cerebras.ai/support/pricing>
  - <https://inference-docs.cerebras.ai/support/rate-limits>
  - <https://inference-docs.cerebras.ai/resources/openai>
- Mistral:
  - <https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key>
  - <https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them>
- Zhipu AI:
  - <https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash>
  - <https://docs.bigmodel.cn/cn/api/rate-limit>
- SambaNova:
  - <https://docs.sambanova.ai/docs/en/models/rate-limits>
  - <https://docs.sambanova.ai/docs/en/get-started/api-keys-urls>
  - <https://docs.sambanova.ai/docs/en/models/sambacloud-models>
- DeepSeek:
  - <https://api-docs.deepseek.com/quick_start/pricing>
  - <https://api-docs.deepseek.com/api/get-user-balance/>
