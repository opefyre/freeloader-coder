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
- 54 automated tests: passed.
- `npm run studio:build`: passed.
- Desktop visual review at the default browser viewport: passed.
- Mobile visual review at 390 × 844: passed.
- Tablet visual review at 820 × 900: passed.
- Wide-desktop review at 1600 × 1000: passed; activity dock visible and no
  horizontal overflow.
- Effective 200% reflow review at 640 CSS pixels: passed with no horizontal
  overflow.
- Guided → Advanced state and URL persistence: passed.
- Command palette open/close flow on mobile: passed.
- Keyboard shortcut and Escape dismissal: passed.
- Demo decision selection, pressed state, and no-side-effect notice: passed.
- Workspace deep-link navigation and browser Back flow: passed.
- Browser console errors during interaction checks: none.

## Trust notes

- No model, provider, Jira, or pipeline claim is fetched from production yet.
  Operational values shown in this slice are clearly contained fixture content
  for UI development and are visibly labeled as demo data.
- External GitHub navigation uses an explicit trusted URL.
- Deep links contain identifiers and display state only; tokens, commands,
  filesystem paths, and secrets are rejected by the navigation contract.

## 2026-07-28 redesign regression repair

The shadcn visual redesign had preserved the navigation labels but temporarily
reduced them to mostly static anchors. This increment restored the verified
behavior inside the new Onest/amber interface:

- desktop sidebar and mobile navigation now open dedicated Overview,
  Conversation, Work, Providers, Evidence, and Settings surfaces;
- the selected surface is persisted in the URL and reconciled through browser
  Back/Forward events;
- navigation clears stale fragment identifiers instead of carrying hidden tab
  state between workspace surfaces;
- `Command/Control + K` opens a searchable, keyboard-dismissable command
  palette;
- task rows expose explicit Jira evidence links with safe new-tab behavior;
- the active product-name decision records visible local-only selection state;
- Work, Evidence, Providers, and Conversation actions navigate to their
  corresponding context instead of remaining inert;
- the 390 × 844 mobile view was corrected to eliminate a min-content overflow
  in the active Work card.

### Increment verification

- `npm run verify`: passed.
- 88 automated tests: passed.
- `npm run studio:build`: passed.
- Desktop dark-mode visual review: passed.
- Mobile light-mode review at 390 × 844: passed.
- Mobile horizontal overflow: none (`scrollWidth` = `clientWidth` = 390).
- Sidebar/mobile current-page state: passed.
- URL persistence and browser Back: passed.
- Search, command filtering, command navigation, and Escape dismissal: passed.
- Browser console warnings/errors: none.
