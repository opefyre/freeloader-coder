# Safe support reporting

The support preview is generated and redacted locally. Nothing is sent until
the user reviews the destination and explicitly submits outside the demo.

## Public issue content

Include observable behavior, expected behavior, minimal reproduction steps,
supported version, platform facts, correlation IDs, and redacted diagnostics.
Do not include API keys, tokens, passwords, source code, proprietary file
contents, personal paths, email addresses, account identifiers, health data, or
financial data.

Use the dedicated bug, provider, installation, feature, or documentation issue
template. Unsupported customizations should receive a documented extension or
community alternative rather than a false product promise.

## Security vulnerabilities

Do not open a public issue. Use the repository's private GitHub security
advisory flow. Provide the smallest reproducible description and wait for the
maintainer's coordinated-disclosure response.

## Response expectations

- Reproducible bugs on supported versions: triage target of five working days.
- Provider incidents: verify current provider status and policy before changing
  the adapter.
- Security reports: acknowledge privately and avoid public detail until fixed.
- Requests outside supported behavior: explain the boundary and a safe
  alternative.

Moderators may remove leaked secrets or personal data, close duplicates, and
redirect general questions to Discussions. Leaked credentials must be revoked,
not merely deleted from the issue.
