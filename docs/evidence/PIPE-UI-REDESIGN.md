# Pipeline Studio UI direction correction

## Outcome

The initial command-center renderer was removed and replaced with a
Household-compatible shadcn application shell.

## Locked implementation

- React 19 rendering through Vite
- Tailwind v4 and shadcn semantic tokens
- Base UI buttons and tabs
- Manrope as the sole typeface
- Phosphor as the sole icon family
- Pipeline-specific molten-amber/graphite palette with no decorative gradients
- Responsive sidebar, summary cards, active-run stages, provider execution,
  reliability, cost safeguards, decisions, and assistant input

## Trust rules

- All current operational values are labeled as demo data.
- Provider execution is derived from the provider telemetry fixture and exposes
  all configured providers rather than a single hard-coded provider.
- Cost protection displays the hard ceiling and its safeguards.
- Interactive demo actions state explicitly when no durable task is created.

## Verification

The repository typecheck, tests, production build, and browser checks are
required before this redesign is committed.
