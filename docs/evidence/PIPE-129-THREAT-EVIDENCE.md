# PIPE-129 — Threat-model release evidence

All PIPE-47 acceptance criteria map to executable coverage or the owned threat
artifact in `docs/evidence/PIPE-47-THREAT-MODEL.md`.

The suite deliberately exercises lexical escape, symlink escape, approval
replay, policy mismatch, tampered updates, unsigned updates, and unowned
residual high risk. The existing scanner, sandbox, tool, provider, and policy
suites remain required and no gate is waived.

