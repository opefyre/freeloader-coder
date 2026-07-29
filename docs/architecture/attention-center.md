# Attention Center architecture

## Purpose

The Attention Center makes long-running local automation observable without
turning every event into noise. It is a durable local disposition layer over
canonical operational evidence. It does not change request, provider, Git,
Jira, GitHub, deployment, or validation state.

## Canonical inputs

- Decision Inbox items: approvals, missing input, provider waits, failures,
  recovery, policy, and conflict observations.
- Live operations: verified completion observations only.
- Private attention state: read, acknowledged, snoozed, quiet-hours,
  revisions, bounded receipts, and idempotency bindings.

Unknown observations are not promoted to urgent attention. Healthy idle state
is not an alert.

## Identity and lifecycle

Every item uses a SHA-256-derived stable source fingerprint and public opaque
ID. Repeated canonical observations update one identity. Dispositions are:

1. `unread`
2. `read`
3. `acknowledged`
4. `snoozed`

Snoozes expire deterministically and return to unread. Severity can change
without creating a second identity. Every local mutation requires the current
item or store revision plus a 16–128 character idempotency key. Replaying an
identical request returns the original receipt; reusing the key for a different
request fails with conflict.

## Quiet hours

Quiet hours use an explicit IANA timezone and local start/end minutes. A window
may cross midnight. Non-critical delivery is suppressed while the window is
active, but items remain visible in the full workspace. Critical alerts always
bypass. The UI shows the next delivery time and never claims an alert was
resolved because it was suppressed.

## API

- `GET /api/v1/attention`
- `POST /api/v1/attention/preview`
- `POST /api/v1/attention/actions`
- `POST /api/v1/attention/quiet-hours/preview`
- `POST /api/v1/attention/quiet-hours`

The API binds to loopback, rejects remote origins, uses no-store responses,
strict schemas, bounded bodies and concurrency, and requires idempotency for
mutations.

## Privacy

Credentials, token-like values, prompts, source bodies, provider bodies,
personal paths, and external-write payloads are excluded or redacted. Browser
results contain opaque source IDs and safe internal references only. The
automatic spend limit is structurally zero.

## Recovery

Durable state is written with a private temporary file and atomic rename.
Mutations are serialized. Corrupt state fails closed with explicit preservation
and restore/remove guidance. Current unresolved canonical attention is never
deleted by retention pruning.

## UI

The global bell polls bounded current state every 15 seconds and shows the exact
unsuppressed unread count. Its glass preview displays up to four canonical
items. The `/attention` workspace provides severity lanes, facets, search,
evidence, acknowledgement, snooze, quiet-hours, empty/offline states, and safe
navigation.
