# PIPE-32 — Design System Evidence

## Outcome

Pipeline Studio now has one executable visual language and a rendered,
interactive component gallery. Canonical state and component meaning live in
`packages/ui`; the Studio browser surface consumes those contracts rather than
redefining them.

## Acceptance evidence

### AC1 — Gallery coverage

Passed. The generated matrix covers 12 operational states, four breakpoints,
two density modes, and ten primitive families: 96 complete scenarios and 960
primitive examples. The browser gallery switches state, breakpoint context,
and Guided/Advanced density from those canonical records.

Responsive source gates assert tablet and mobile reflow rules. Desktop visual
QA was performed at a 1280 × 720 CSS-pixel viewport. The first pass exposed
hero clipping and browser-default button borders; both were corrected before
acceptance.

### AC2 — Icon consistency and accessibility

Passed. The browser build imports only Lucide. Icons that repeat adjacent text
are hidden from assistive technology. The reusable contract rejects meaningful
icons without an accessible name. No icon CDN or placeholder glyph is used.

### AC3 — Automated design guardrails

Passed. Repository lint rejects:

- feature-level font declarations that bypass the Onest token;
- raw feature color literals;
- decorative CSS borders;
- React Icons, Heroicons, Phosphor, and Font Awesome imports.

## Additional trust evidence

- Blocking states require preserved-work and recommended-action content.
- Visual interaction testing confirmed failure cards render both messages.
- Browser console inspection found no application errors.
- Reduced-motion and forced-color fallbacks are present.
- The local font and icon assets build without a remote runtime dependency.

## Verification

The final gate runs setup, formatting, repository lint, strict TypeScript,
build, all offline tests, and a production Vite browser build. Observable test
and build results—not a UI claim—determine completion.
