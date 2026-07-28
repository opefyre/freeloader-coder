# Expanded provider mesh

Sprint 14 adds Cerebras, Mistral Experiment, Zhipu GLM, SambaNova, and DeepSeek
promotional credit without weakening Pipeline Studio's denial-of-wallet contract.

## Admission contract

Every external route starts ineligible. It becomes eligible only when fresh,
credential-free account evidence proves:

1. the exact provider and model;
2. the account's plan or access mode;
3. billing is disabled;
4. the region can use that model;
5. a capability canary passed for the requested work;
6. account-observed quota has remaining capacity.

Unknown is not treated as free. Expired evidence is not treated as current.
Credentials, prompts, source payloads, and model output cannot be stored in the
admission evidence object.

## Provider-specific behavior

| Provider | Admission | Capacity behavior | Important boundary |
| --- | --- | --- | --- |
| Cerebras | Free account plus live account limits | Uses observed limits; no marketing defaults | Required capabilities must pass a canary |
| Mistral | Experiment plan only | Unknown quotas remain unknown and single-flight | Paid or unknown plans are denied |
| Zhipu GLM | Explicit free model in an allowed region | Uses model-specific context and output limits | Region errors become a localized needs-user state |
| SambaNova | Free account with no payment method | Scarce allowance; four daily calls and token capacity reserved for review/recovery | Planning cannot consume the protected reserve |
| DeepSeek | Explicit promotional-credit mode | Uses only proven granted credit above a hard reserve | Never joins the permanent free pool; topped-up funds remain unusable |

## Routing sequence

1. Classify and redact the intended payload.
2. Load fresh account, quota, and capability evidence.
3. Reject paid, billing-enabled, unknown-cost, region-blocked, or oversized routes.
4. Preserve provider-specific reserves.
5. Select the highest-priority eligible route.
6. If capacity is temporarily exhausted, persist a wake time instead of polling.
7. If no safe route exists, explain the exact blocker and alternatives.

The route request must separately opt into promotional credit. `allowPaid` never
authorizes promotional balance use, and promotional balance use never authorizes a
top-up or paid route.

## Operator experience

The Providers page includes an interactive, explicitly demo-scoped mesh lab. It
shows honest access classes, observed-versus-unknown limits, reserves, capability
proof, provider dashboards, primary sources, and linked Jira work. Its failure
simulator demonstrates scheduled quota waits, region restrictions, stale evidence,
and healthy dispatch without mutating credentials or provider accounts.
