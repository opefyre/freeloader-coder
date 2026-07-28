# PIPE-181 · Zhipu GLM

- Requires an explicitly free model and allowed account region.
- Enforces model-specific context/output boundaries before dispatch.
- Region failures become a localized `needs_user` state rather than retry churn.
- Chinese region errors are classified without storing request content.

Verification: focused tests cover region restriction, localized classification, and oversized input.
