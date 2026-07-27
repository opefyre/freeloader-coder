# Pipeline Studio Design System

## Direction

Pipeline Studio uses one calm, high-contrast dark language. Depth comes from
light, blur, tone, and spacing—not decorative border grids. Glass is used to
clarify hierarchy, never to reduce legibility.

## Locked choices

- Typeface: Geist only, with system fallback while the local font loads.
- Icons: Lucide only. Meaningful icons require an accessible name; decorative
  icons are hidden from assistive technology.
- Color: semantic design tokens only. Feature code must not introduce raw
  color literals.
- Surfaces: tokenized glass and elevation. Feature code must not add decorative
  borders.
- Motion: three duration tokens and a zero-motion equivalent.
- Density: Guided and Advanced use the same components and meaning. Only
  spacing, control height, and information disclosure change.

## Operational truth

Loading, empty, working, partial, offline, permission denied, quota exhausted,
failed, retrying, recovering, restored, and succeeded are first-class states.
Visual tone never replaces a text label. Blocking states must say what remains
safe and give one recommended next action.

## Component contracts

The reusable primitive families are status, evidence, approval, risk, cost,
provider, task, timeline, preview, and recovery. Their canonical contracts live
in `packages/ui/src/contracts.ts`; the gallery is generated from those
contracts rather than maintained as disconnected mockups.

## Responsive rules

- Mobile: one decision per viewport; primary action remains reachable.
- Tablet: navigation and current work may share the viewport.
- Laptop: Guided mode is the default; evidence opens without losing context.
- Wide: Advanced density may expose parallel evidence and activity.
- At 200% zoom, layouts reflow; horizontal page scrolling is not an accepted
  substitute.

## Review policy

Repository checks reject unapproved font declarations, icon packages, raw color
literals, and decorative borders in feature CSS. Token definitions and explicit
forced-color accessibility fallbacks are the only reviewed exceptions.
