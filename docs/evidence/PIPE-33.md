# PIPE-33 — Workspace navigation shell

## Delivered

- Route-aware workspace shell backed by the canonical navigation contract.
- Safe local deep links for Control center, Conversation, Current work, Needs you,
  Checkpoints, Preview, Restore, and Help.
- Guided and Advanced density modes persisted in the URL.
- Browser Back/Forward support through History API state reconciliation.
- Responsive desktop, compact-sidebar, and mobile-bottom-navigation layouts.
- Keyboard-accessible command palette with `Control/Command + K` and Escape.
- Clear current-work, decision, checkpoint, preview, recovery, and help entry
  points.
- Dedicated `/design-system` route preserving the component gallery.
- Reduced-motion handling, a universal skip link, and mobile-accessible command
  naming.

## Verification

- `npm run verify`: passed.
- 51 automated tests: passed.
- `npm run studio:build`: passed.
- Desktop visual review at the default browser viewport: passed.
- Mobile visual review at 390 × 844: passed.
- Tablet visual review at 820 × 900: passed.
- Effective 200% reflow review at 640 CSS pixels: passed with no horizontal
  overflow.
- Guided → Advanced state and URL persistence: passed.
- Command palette open/close flow on mobile: passed.
- Keyboard shortcut and Escape dismissal: passed.
- Workspace deep-link navigation and browser Back flow: passed.
- Browser console errors during interaction checks: none.

## Trust notes

- No model, provider, Jira, or pipeline claim is fetched from production yet.
  Operational values shown in this slice are clearly contained fixture content
  for UI development and are visibly labeled as demo data.
- External GitHub navigation uses an explicit trusted URL.
- Deep links contain identifiers and display state only; tokens, commands,
  filesystem paths, and secrets are rejected by the navigation contract.
