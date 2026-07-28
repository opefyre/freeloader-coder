# PIPE-53 — Multimodal request composer

Status: verified locally on 2026-07-28.

## Outcome

The Studio conversation screen now accepts an outcome, templates, images,
selected files, HTTPS links, and project references. Every item is previewed,
removable, locally screened, and digest-cited before provider context exists.

## Acceptance evidence

- Accepted attachments are project scoped and bound to browser-safe SHA-256
  citations.
- Removed, denied, oversized, unsupported, insecure, and sensitive items never
  reach citations or provider payloads.
- Missing or conflicting intent creates a focused blocking question. A missing
  implementation preference becomes an explicit editable assumption.
- Clearing the composer is safe: the interface remains usable and cannot create
  provider work.
- Browser QA proved safe and blocked attachment states, removal, review status,
  templates, light/dark themes, and mobile/desktop reflow.

## Verification

- Full repository verification: 250 passed, 0 failed
- Production Studio build: passed
- Browser errors: 0
- Desktop overflow: 0 px
- Mobile 390 × 844 overflow: 0 px
