# PIPE-183 · DeepSeek promotional credit

- Classified honestly as promotional credit, not a permanent free tier.
- Requires explicit promotional mode, known balance composition, and proven separation of granted from topped-up funds.
- A hard reserve and expiry are enforced before routing.
- Default free routing rejects the candidate; `allowPaid` does not bypass the credit boundary.
- No top-up or billing path is implemented.

Verification: focused tests cover default denial, explicit bounded admission, reserve exhaustion,
expiry primitives, and ambiguous-balance denial.
