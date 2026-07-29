# Sprint 23 hard-gates evidence

Scope: PIPE-193–196.

## Registry

- `apps/studio/src/routing.ts` is the canonical registry for all 13
  workspaces: path, desktop/mobile label, note, page copy, navigation group,
  and mobile visibility.
- Desktop navigation, secondary navigation, mobile navigation, command search,
  canonical URLs, and page headers derive from the same records.
- Registry validation fails on duplicate paths, relative paths, empty identity,
  or incomplete reader-facing copy.
- Demo-sensitive headers now say synthetic, demo, or demo connection rather
  than implying a live observation.

## Production budgets

| Class | Measured maximum | Budget |
| --- | ---: | ---: |
| Entry | 390,297 bytes | 450,000 bytes |
| Shared | 189,644 bytes | 210,000 bytes |
| Feature | 58,032 bytes | 75,000 bytes |

`npm run studio:release-check` builds TypeScript, produces the Studio bundle
and manifest, measures every JavaScript artifact, names its class and limit,
and fails closed on a missing entry or invalid/oversized measurement.

## Recovery evidence

- The Demo workspace disclosure exposes a named `Preview safe failure`
  control.
- The synthetic fault produced the route-local `Workspace contained` alert
  while the shell, theme, navigation, and `/launch` URL remained present.
- `Retry workspace` cleared the fault and restored the Launch workspace.
- A second fault followed by `Return to overview` cleared the fault and
  navigated to `/`.
- The recovery copy confirmed that no task, provider, repository, or external
  service changed.

## Verification

- `npm run verify`: passed, 451/451 tests.
- `npm run studio:release-check`: passed all entry/shared/feature budgets.
- Browser QA: safe fault, retry, safe return, direct `/providers`, light/dark,
  and registry-derived navigation passed.
- Responsive QA: `/providers` at 390 × 844 reported
  `scrollWidth === innerWidth === 390`.
- A clean browser session reported zero warnings or errors. The explicitly
  triggered synthetic render error was contained as designed.
- `git diff --check`: passed.

## Non-actions

No deployment, provider call, API key, paid usage, analytics, repository
mutation, or external product action occurred.
