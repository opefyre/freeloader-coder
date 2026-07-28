# Review previews and evidence

A preview is useful only when it is tied to the source revision and validation
that produced it.

## Review sequence

1. Open the checkpoint from **Work** or **Evidence**.
2. Compare screenshots and behavior with the requested outcome.
3. Inspect the bounded diff and confirm unrelated files are absent.
4. Review deterministic checks such as typecheck, tests, build, and relevant
   functional validation.
5. Review independent quality and design findings.
6. Accept the result only when observable postconditions pass.

Model confidence, a plausible screenshot, or a clean diff alone is not proof of
completion. The interface must label missing, stale, partial, and fixture
evidence honestly.

If proof is incomplete, keep the checkpoint local and return the task for
repair or use [recovery](recovery.md).
