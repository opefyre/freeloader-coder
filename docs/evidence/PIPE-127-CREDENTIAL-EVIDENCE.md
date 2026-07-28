# PIPE-127 — Credential-store release evidence

All PIPE-43 acceptance criteria map to executable coverage or named browser
evidence in `docs/evidence/PIPE-43-CREDENTIAL-STORE.md`.

The suite deliberately exercises duplicate references, provider-scope denial,
missing native storage, rotation, revocation, deletion, export exclusion,
encrypted fallback, and native-command argument leakage. Fixtures contain
synthetic values only and use temporary local state.

