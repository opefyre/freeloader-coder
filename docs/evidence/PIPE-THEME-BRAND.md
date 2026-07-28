# Theme and brand implementation evidence

## Outcome

Pipeline Studio now provides system, light, and dark themes plus an original
vector product mark.

## Theme contract

- System preference is the first-run default.
- Users can explicitly select light or dark mode.
- The selected mode persists locally.
- System-mode changes react to operating-system preference updates.
- Browser chrome color follows the resolved theme.
- Mobile and desktop controls expose the same canonical preference.
- Light mode uses warm paper neutrals; dark mode uses neutral graphite.
- Molten amber is reserved for brand, primary actions, focus, and live state.
- Decorative gradients are prohibited; chart fills may use sharp semantic
  segments only when they encode data.
- Instrument Sans is the only product typeface.

## Brand contract

The mark is the custom Orchestration Core. Five negative-space channels enter
one solid control block, meet inside a protected central chamber, and leave
through one clean result channel. This directly represents provider diversity,
controlled orchestration, and one validated output. The compact silhouette
remains legible at favicon size and does not depend on the icon library.

Reusable assets:

- `apps/studio/public/pipeline-studio-mark.svg`
- `docs/brand/pipeline-studio-logo.svg`
- `apps/studio/src/components/brand/pipeline-mark.tsx`

## Verification

Both themes require production build, browser rendering, persistence,
interaction, desktop, and mobile checks before commit.
