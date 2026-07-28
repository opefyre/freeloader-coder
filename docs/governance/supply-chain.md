# Supply-chain policy

Pipeline Studio fails closed when required dependency, build, artifact,
provenance, signature, secret, or license evidence is missing, stale, or
contradictory.

## Required release evidence

- exact source commit and clean working-tree scope;
- committed lockfile and dependency graph;
- dependency vulnerability and license-policy results;
- secret scan with no unresolved credential finding;
- reproducible build inputs and deterministic checks;
- source archive, checksums, SBOM, and provenance;
- verified release-manifest signature;
- clean-environment verification and rollback evidence.

## Dependency rules

Dependencies are exact-pinned through the lockfile. A dependency change must
identify why it is needed, its source, license, transitive effect, known
vulnerabilities, and removal path. Install scripts and binary downloads are
treated as untrusted effects. A critical unresolved vulnerability, denied
license, unexpected package, or lockfile mismatch blocks promotion.

## Build and artifact rules

Builds consume the recorded source and lockfile. Release artifacts name their
digest, size, provenance, and producing commit. A release is not promoted when
the build cannot be reproduced within documented constraints, provenance points
to another commit, the signature is invalid, or a required artifact is absent.

## Secrets

Credentials, tokens, private keys, personal data, private source, and absolute
user paths are forbidden in fixtures, logs, release evidence, issues, and
artifacts. A detected credential blocks release and requires removal and
rotation; deleting the string alone is insufficient.

## Response

1. Stop promotion and preserve the failing evidence.
2. Classify the smallest affected dependency, artifact, release, or credential.
3. Remediate without weakening or renaming the failed gate.
4. Add a regression fixture that fails before the fix.
5. Rerun the complete required gate and attach current evidence.

The Trust Center simulation changes local fixture state only. It creates no
package, tag, release, CI run, deployment, or external issue.

Owner: Security steward and release owner  
Last reviewed: 2026-07-28  
Next review: 2026-10-28
