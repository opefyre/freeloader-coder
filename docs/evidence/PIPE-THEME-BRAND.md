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

The mark is a custom P-shaped pipeline: a continuous route, three execution
nodes, and a small verified-completion gesture. It remains recognizable at
favicon size and does not depend on the icon library.

Reusable assets:

- `apps/studio/public/pipeline-studio-mark.svg`
- `docs/brand/pipeline-studio-logo.svg`
- `apps/studio/src/components/brand/pipeline-mark.tsx`

## Verification

Both themes require production build, browser rendering, persistence,
interaction, desktop, and mobile checks before commit.
