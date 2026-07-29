# Sprint 22 release-hardening evidence

Scope: PIPE-189–192.

## Baseline and result

| Gate | Baseline | Sprint 22 result |
| --- | ---: | ---: |
| Production entry JavaScript | 1,021.51 kB / 286.03 kB gzip | 390.41 kB / 106.20 kB gzip |
| Feature chunks | One primary application chunk | 15 named feature chunks plus shared runtime chunks |
| Oversized-chunk warning | Present | Eliminated |
| Global data mode | “Pipeline online” | “Demo workspace” with inspectable provenance |
| Route failure behavior | Unbounded | Route-scoped boundary with retry and safe return |

The entry payload decreased by 61.8% uncompressed and 62.9% gzip. Production
build output is the source of these measurements.

## Deterministic evidence

- `tests/presentation-provenance.test.ts` protects fail-closed demo, stale, and
  current external-verification behavior.
- `tests/studio-release-hardening.test.ts` protects lazy route imports,
  accessible loading, bounded recovery, provenance language, and build chunking.
- `apps/studio/src/components/shell/route-boundary.tsx` preserves the Studio
  shell and offers retry or a safe return to Overview.
- `apps/studio/src/components/shell/demo-data-disclosure.tsx` states exactly
  which source classes are synthetic and which actions never occurred.

## Browser evidence

- Direct `/launch`, `/providers`, and `/conversation` navigation passed.
- Lazy workspaces resolved without blanking the surrounding shell.
- Demo provenance disclosure opened and closed through named,
  keyboard-accessible controls.
- Light and dark themes passed.
- `/conversation` at 390 × 844 reported
  `scrollWidth === innerWidth === 390`.
- Browser console reported zero warnings or errors.

## Verification result

- `npm run verify`: passed, 445/445 tests.
- `npm run studio:build`: passed with no oversized-chunk warning.
- `git diff --check`: passed.

## Boundaries

- No deployment, provider call, API key, paid usage, analytics, repository
  write, or external verification was performed.
- Route error details intentionally exclude stack traces, source paths, and
  project content.
