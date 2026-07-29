# Sprint 19 executable release evidence

Candidate: `0.8.0-beta.4`  
Registry: `registry-s19-executable-proof`  
Sprint: `PIPE S19: Executable Proof`

## Decision

Thirty required acceptance-criterion mappings across ten capabilities pass.
The registry rejects unknown fields, unsafe fixtures, duplicate identities, and
future-dated verification. Missing, failed, not-run, stale, expired, or waived
required proof blocks readiness. There is no silent waiver path.

## Coverage

| Ticket | Parent | Capability | Primary executable evidence | Negative fixture |
| --- | --- | --- | --- | --- |
| PIPE-125 | PIPE-44 | Repository scan | `tests/onboarding-scanner.test.ts` | Missing or unsupported repository layout |
| PIPE-126 | PIPE-42 | First outcome | `tests/onboarding-journey.test.ts` | Preview or validation cannot complete |
| PIPE-128 | PIPE-45 | Approval policy | `tests/effect-policy.test.ts` | Unapproved or denied effect |
| PIPE-130 | PIPE-48 | Provider adapter | `tests/provider-adapter-contract.test.ts` | Timeout, quota, refusal, or malformed response |
| PIPE-132 | PIPE-50 | Provider routing | `tests/provider-routing-parity.test.ts` | Privacy, quota, cooldown, or circuit violation |
| PIPE-140 | PIPE-61 | Tool execution | `tests/execution-tools.test.ts` | Missing permission, postcondition, or audit |
| PIPE-141 | PIPE-60 | Execution isolation | `tests/execution-isolation.test.ts` | Protected path or resource boundary violation |
| PIPE-142 | PIPE-62 | Safe apply | `tests/repository-safety-parity.test.ts` | Patch conflict or interrupted rollback |
| PIPE-170 | PIPE-97 | Release package | `tests/release-lifecycle.test.ts` | Missing artifact, checksum, or provenance |
| PIPE-171 | PIPE-98 | Safe update | `tests/release-lifecycle.test.ts` | Incompatible, interrupted, or unrestorable update |

Each ticket maps AC1–AC3 to a current artifact, named owner, reproducible
command, expiry, and synthetic negative fixture. Fixtures contain no
credentials, personal data, private source, or user filesystem paths.

## Reproduce

```sh
npm run verify
npm run studio:build
```

The Evidence Center → Release registry surface provides the human review. Use
**Break routing proof** to prove a single failed required check stops promotion,
then **Restore passing registry** to rerun the passing fixture.

## Current verification

- `npm run verify`: 416 tests passed; zero failed, skipped, or cancelled.
- `npm run studio:build`: production bundle completed successfully.
- Dark and light themes were reviewed in the running Studio.
- The release registry reported 30/30 checks, 10 tickets, and 6 domains.
- Deliberately breaking routing proof changed the decision to **Release
  blocked**, surfaced one failed check, and stopped promotion.
- Restoring the passing registry returned the decision to **Release evidence
  ready** and **Fail-closed gate passed**.
- Ticket and GitHub evidence links were present and the release-package
  selection showed its exact source claim.
- The reviewed 1280 px viewport had zero horizontal overflow.
- No application warning or error was recorded in the browser console.
