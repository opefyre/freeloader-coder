# PIPE-100–104 guidance and support evidence

## Delivered

- Stable `/help` route in desktop and mobile navigation.
- Searchable, versioned, offline guidance catalogue for seven first-use
  journeys.
- Product-aware recovery navigator for quota, offline, permission,
  interruption, and unsupported states.
- Locally redacted support-report preview with explicit consent, public/private
  destination selection, and source-disclosure blocking.
- User guides for projects, providers, plans, previews, recovery, and publishing.
- Public support templates, private security disclosure, response expectations,
  safe alternatives, and contributor contracts.
- Direct links from in-product guidance to its Jira acceptance ticket, GitHub
  source guide, contributor guide, and private security advisory.

## Verification

- `npm run verify`: 371 passed, 0 failed.
- `npm run studio:build`: production build completed.
- Browser functional review:
  - search for `quota` returned grounded recovery guidance;
  - recovery symptom selection changed the recommended article;
  - security reports selected the private-advisory destination;
  - support copy remained disabled until redacted-preview consent;
  - the generated preview reported two local redactions.
- Browser visual review:
  - desktop light and dark themes reviewed;
  - 390 × 844 mobile layout reviewed;
  - eight mobile destinations remained present with compact labels;
  - horizontal document overflow was zero at desktop and mobile widths;
  - a clean-tab load produced no console errors.

## Trust boundaries

The Help Center is an interactive UI demo. It does not submit a report or make
any external write. Core articles are available offline. Credentials, source
code, personal paths, emails, and account data are redacted or blocked before a
draft can become shareable.
