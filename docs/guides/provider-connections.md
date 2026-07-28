# Connect a free provider

Provider admission is evidence-based. A credential alone does not make a route
ready: Pipeline Studio verifies the account, eligible models, capabilities,
quota signals, and free-only policy first.

## Connection flow

1. Open **Settings → Connections** and select a provider.
2. Follow the provider-dashboard link and create the narrowest suitable API key.
3. Paste the key only into secure entry. The application stores it in the
   operating-system credential vault, never the repository or local database.
4. Review the connection check: identity, model catalogue, capability fit,
   known quota window, retention notice, and paid-route lock.
5. Enable the route only when the result says **Ready**.

## Revocation

Revoke the credential in the provider dashboard, then remove the connection in
Pipeline Studio. A revoked or unverifiable credential must immediately stop
receiving new work. Existing evidence remains available without the secret.

## Free-only limitation

Free-tier terms and limits can change. Pipeline Studio treats missing or
ambiguous price evidence as unavailable, not free. It schedules work for a
later reset or chooses another eligible provider rather than silently paying.

Provider policies and admission evidence are linked from the **Providers**
screen. Credential handling is described in
[credential storage](../security/credential-storage.md).
