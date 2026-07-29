# Universal Command Center

## Purpose

The global command center turns the Studio header search affordance into one
keyboard-first route to canonical work, decisions, activity, projects,
providers, evidence, settings, and every workspace destination.

## Deterministic index

The loopback control plane builds a bounded current-state index on demand from
Live Operations, Activity Explorer, Decision Inbox, provider observations, and
a static canonical workspace registry. It does not crawl source files, retain
queries, build a hidden vector database, or use an AI ranker.

Unicode-normalized queries use exact, prefix, phrase, all-token, and partial
token tiers. Scope and bounded recency provide deterministic tie-breaks.
Stable SHA-derived identities, conflict-detecting deduplication, safe highlight
ranges, grouped counts, and a stable final identity sort make refreshes
repeatable.

## Safety boundary

Every result contains a schema-validated internal path. Activation is navigation
only. Search cannot approve, retry, mutate, call providers, publish, write
externally, or enable paid use. Automatic spend is structurally `$0`.

Credentials, prompts, source bodies, provider bodies, personal paths, and
sensitive values are excluded or redacted. Query telemetry is limited to
length, result counts, scopes, and truncation; query content is not persisted.

## Experience

Command-K or Control-K opens the modal from any route. The surface provides
empty-query destinations, live grouped results, multi-scope chips, source and
privacy details, cancellation of superseded requests, and explicit loading,
no-match, offline, and safe-empty states.

Dialog, combobox, listbox, active-descendant, ArrowUp/ArrowDown, Home/End,
Enter, Escape, focus restoration, visible focus, live counts, responsive
layout, reduced-motion compatibility, and light/dark themes are part of the
release contract.
