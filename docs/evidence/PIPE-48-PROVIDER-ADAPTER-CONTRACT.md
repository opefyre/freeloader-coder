# PIPE-48 provider adapter contract and compatibility suite

Date: 2026-07-28

## Outcome

All supported OpenAI-compatible providers now implement one versioned boundary for credential validation, model discovery, quota discovery, chat, streaming, usage, errors, and optional structured/tool behavior.

## Contract

- Strict version 1 manifest with provider identity, semantic adapter version, protocol, declared capabilities, default timeout, and official sources.
- Strict normalized model records with context/output limits, capabilities, lifecycle, retirement time, and extensions.
- Strict normalized responses with request/provider/model identity, content, finish reason, usage, tool calls, and `verified: false`.
- Strict safe failures for authentication, permission, quota, rate limit, retirement, model availability, schema compatibility, timeout, outage, malformed response, and rejection.
- Provider-specific data is rejected at canonical boundaries unless wrapped in a versioned namespaced extension.
- Streaming terminates only with a normalized completed response.

## Compatibility suite

The reusable suite verifies:

1. credential validation;
2. model discovery;
3. current quota evidence;
4. normalized response identity and usage;
5. deterministic normalized streaming; and
6. secret exclusion from compatibility evidence.

Recorded adapters for Cerebras, Mistral, Zhipu AI, and SambaNova pass the exact same suite. Malformed usage, unknown fields, unversioned proprietary fields, missing models, incomplete streams, invalid credentials, and raw provider failures are rejected before orchestration.

## Release evidence

- A provider adapter change cannot satisfy repository verification unless the shared contract and compatibility tests compile and pass.
- `npm run verify`: all 128 tests passed with formatting, lint, type checking, and build.
- Compatibility tests cover all four verified permanent/account-limited free endpoints.
- Opt-in live capability canaries use the same normalized OpenAI-compatible boundary and never run during offline repository verification.
