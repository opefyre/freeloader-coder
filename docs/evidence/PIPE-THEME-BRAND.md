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

## Brand contract

The mark is the custom Relay. Four offset stages advance as one architectural
sequence and resolve into a single execution plane. It communicates continuous,
coordinated progress without a monogram, arrows, nodes, a checkmark, or a
generic developer-tool glyph. Its filled silhouette remains legible at favicon
size and does not depend on the icon library.

Reusable assets:

- `apps/studio/public/pipeline-studio-mark.svg`
- `docs/brand/pipeline-studio-logo.svg`
- `apps/studio/src/components/brand/pipeline-mark.tsx`

## Verification

Both themes require production build, browser rendering, persistence,
interaction, desktop, and mobile checks before commit.
