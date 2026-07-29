# PIPE-209–214: real local request intake proof

## Delivered

- Versioned, strict browser contracts for local request creation, readiness findings,
  deterministic work previews, queue lifecycle, collections, and mutation responses.
- A private `0700`/`0600` atomic request store with schema validation, fsync + rename,
  serialized writes, stable opaque identities, idempotent creation, guarded transitions,
  corruption preservation, and a 500-record bound.
- Loopback-only list, create, cancel, and archive endpoints with allowed-origin checks,
  bounded JSON, explicit methods, idempotency keys, safe errors, and no-store responses.
- A real Conversation intake surface linked to the existing private project registry.
- A real Work queue with observed state, deterministic provenance, safe cancel/archive,
  bounded polling, offline recovery, and explicit separation from synthetic examples.

## Automated evidence

- `npm run verify`: passed, 477/477 tests.
- `npm run studio:release-check`: passed.
- Studio entry: 395,924 / 450,000 bytes.
- Shared runtime: 189,644 / 210,000 bytes.
- Largest feature: 58,032 / 75,000 bytes.
- New local-request feature: 12,995 / 75,000 bytes.
- `git diff --check`: passed.

Coverage includes strict contracts, duplicate identity rejection, private permissions,
restart persistence, idempotency replay and conflict, unknown projects, secret-shaped
input, corruption preservation, list/create/cancel/archive API behavior, cross-origin
and malformed request rejection, loopback client response validation, and truthful UI
copy/mounting.

## Browser evidence

Tested against the real Vite Studio and compiled loopback control plane:

1. Registered `/Users/aboshifb/Desktop/Personal/Projects/pipeline-studio`.
2. Confirmed the browser received `pipeline-studio` and an opaque project identity,
   never its absolute path.
3. Created “Add a durable request inbox with clear empty and recovery states.”
4. Confirmed the request appeared on `/conversation` and survived navigation to `/work`.
5. Confirmed Work showed `queued`, the real project name, deterministic preview
   provenance, and repository-check labels without worker/provider claims.
6. Cancelled the queued request and observed the explicit safe-cancel result.
7. Archived the cancelled request and observed the truthful empty state.
8. At 390 × 844, `scrollWidth === clientWidth === 390`; no horizontal overflow.
9. Browser console: zero errors.

## Exact limitations

- This slice does not execute work, call a model, select a provider, run commands, or
  change project source.
- The work preview is one conservative deterministic local preview, not AI
  decomposition. Its provenance is visible.
- Queue state currently supports `queued` and `cancelled`; execution lifecycle comes
  only after a real worker boundary is implemented and evidenced.
- Project registration created during browser QA remains a harmless private local
  metadata record; the repository itself was not changed by registration or queue use.
