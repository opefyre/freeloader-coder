# PIPE-49 — Guided provider connection wizard

Status: verified locally on 2026-07-28.

## Outcome

The Settings → Connections experience now guides Groq, Gemini, OpenRouter,
Cloudflare Workers AI, GitHub Models, and a local model runtime without asking
users to edit files or environment variables.

## Acceptance evidence

- Each provider publishes its exact account page, authorization method,
  minimum permission, free-status rule, data-use summary, four setup steps, and
  provider-side revocation instruction.
- PKCE-style authorization is used for the applicable OpenRouter and Cloudflare
  paths; Groq and Gemini use guided minimum-permission key entry; GitHub uses
  authorization; local models use loopback discovery.
- Validation returns only masked vault evidence. Invalid, expired,
  wrong-project, paid-only, insufficient-permission, and offline states each
  produce a specific repair path.
- The rendered flow supports provider selection, external account links, secure
  verification, repair previews, and local revocation.

## Browser verification

- Desktop light theme at 1440 px: no horizontal overflow.
- Mobile dark theme at 390 px: no horizontal overflow.
- Exercised Gemini selection, wrong-project repair, verified connection,
  immediate masking, and revocation feedback.

## Automated verification

- `tests/provider-connection-wizard.test.ts`
- `tests/studio-provider-wizard.test.ts`
- Full release-gate result recorded in the Sprint 6 completion comment.

