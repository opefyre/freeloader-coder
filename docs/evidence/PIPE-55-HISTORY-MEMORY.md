# PIPE-55 — Conversation history, memory, search, and export

Status: verified locally on 2026-07-28.

## Outcome

Users can search conversations within their permitted project, inspect or
delete remembered assertions, and prepare a selected export without treating
chat as project truth.

## Acceptance evidence

- Project permission is applied before search matching; a synthetic
  other-project conversation remains invisible even for a matching query.
- Search can find permitted conversation content and task references.
- Remembered assertions display source, confidence, scope, and expiry behavior;
  correction and deletion are deterministic.
- Selected export redacts credential-shaped material, excludes hidden prompts,
  and states that conversation history is not canonical project truth.
- Browser QA exercised permitted search, denied-project search, memory deletion,
  and export status.

## Verification

- Full repository verification: 250 passed, 0 failed
- Production Studio build: passed
- Browser errors: 0
