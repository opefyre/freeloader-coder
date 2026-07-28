# PIPE-179 · Cerebras

- Implemented strict account-evidence admission for the exact model and free plan.
- Account-observed limits are mandatory; conservative defaults cannot masquerade as live limits.
- Capability canaries gate routing.
- Added secure guided connection, dashboard/source links, tests, and interactive UI evidence.

Verification: `expanded-provider-mesh.test.ts` covers admission and missing live-limit denial.
