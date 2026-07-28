# PIPE-40 — Repository registration and GitHub clone entry

## Outcome

Pipeline Studio now has a strict repository-intake boundary that accepts either a local repository or a canonical HTTPS GitHub URL and produces the same canonical project record.

## Acceptance evidence

- Local and clone flows normalize the same observed repository into an identical versioned record and stable project ID.
- Clone destinations are inspected before any clone call. Occupied destinations return choices and never invoke the mutation adapter.
- Remote authentication is classified as ready, required, or denied. Private-repository failures provide exact GitHub-access, local-clone, cancel, and Resume verification options.
- Missing paths, non-directories, unsupported layouts, malformed URLs, destination conflicts, clone failures, submodules, LFS, size, commands, risks, and dependencies have typed outcomes.
- Unknown input fields and non-canonical GitHub URLs are rejected.
- The Studio Projects workspace exposes both entry methods and explains that local paths remain local and screen-safe.

## Verification

- `tests/onboarding-registration.test.ts`
- Browser acceptance: GitHub URL, access verification, Resume verification, and local-folder entry rendered and responded correctly.
- Full verification: 168 tests passed, 0 failed; typecheck, lint, formatting, setup, core build, Studio build, and diff check passed.

