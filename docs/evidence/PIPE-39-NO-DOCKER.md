# PIPE-39 — Guided no-container execution

Status: verified locally on 2026-07-28.

## Outcome

Pipeline Studio can start without a container runtime while truthfully
distinguishing reduced native isolation from strong container isolation.

## Acceptance evidence

- Native bounded mode supports lightweight work without Docker under
  workspace, command, network, concurrency, and timeout limits.
- Strong container mode remains available when a project or policy requires
  it, with direct Docker and Podman installation references and a verification
  resume point.
- The product never labels reduced isolation as equivalent to a container and
  lists the capabilities that are unavailable in reduced mode.
- Choosing `Continue without Docker` returns to the supported reduced mode
  without installing anything or blocking first launch.

## Verification

- `tests/runtime-sandbox.test.ts`
- `tests/studio-runtime-setup.test.ts`
- Browser QA opened the optional container path, verified both provider links
  and the resume action, then continued successfully without Docker.
- Full release gate: 213 tests passed, 0 failed.

