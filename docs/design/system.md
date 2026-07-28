# Pipeline Studio Design System

## Direction

Pipeline Studio uses the same calm shadcn component language as the Household
reference application so both products feel deliberate and familiar. It is not
a clone: Pipeline Studio uses a restrained molten-amber/graphite identity, denser
operational layouts, and data-first content. Depth comes from semantic surface
tones, soft elevation, and spacing rather than decorative grids or sci-fi
effects.

## Locked choices

- Typeface: Onest only, with system fallback while the local font loads.
- Themes: system preference by default, with persistent explicit light and dark
  choices. Both themes are release-blocking visual QA targets.
- Components: React, Base UI, Tailwind v4, and shadcn component patterns.
- Icons: Phosphor only. Meaningful icons require an accessible name; decorative
  icons are hidden from assistive technology.
- Brand: the original Pipeline Studio mark is the Orchestration Core. Multiple
  channels enter one solid control block, meet inside a protected chamber, and
  leave through one clean result channel. The negative-space construction
  expresses provider diversity, controlled execution, and validated output
  without relying on a monogram or generic developer-tool icon.
- Color: semantic design tokens only. Feature code must not introduce raw
  color literals.
- Surfaces: rounded shadcn cards, tokenized elevation, subtle rings, and muted
  nested layers. Large glass panels and ornamental border grids are prohibited.
- Motion: three duration tokens and a zero-motion equivalent.
- Density: compact by default, with progressive disclosure for evidence and
  technical details.

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
literals, and decorative borders in feature CSS. The Studio theme and explicit
forced-color accessibility fallbacks are reviewed exceptions. Visual changes
must preserve the shadcn vocabulary and be checked at desktop and mobile sizes.
