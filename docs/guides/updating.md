# Update Pipeline Studio safely

Pipeline Studio uses source releases. An update is a recoverable local
operation, not an automatic deployment.

## Before applying

1. Open **Releases** and verify the target version, source commit, signature,
   artifact manifest, checksums, SBOM, provenance, and required checks.
2. Confirm that the operating system, Node.js runtime, providers, models,
   connectors, and project types you rely on have current compatibility evidence.
3. Let active work reach a checkpoint.
4. Create a project checkpoint and database backup.
5. Review migrations, changed files, disk reservation, known limitations, and
   the exact rollback version.

## Apply and verify

Apply only the displayed source update. Verify setup, schema replay, provider
contracts, projects, and visible Studio behavior before declaring success.
Credentials remain in the operating-system vault and are not copied into the
release or backup.

If the process is interrupted after preservation, Pipeline Studio pauses and
offers a bounded restore of the last compatible source and database state.
Without complete preservation evidence, it stops for user review rather than
guessing.

Remain on the current supported version when the release signature,
compatibility evidence, free disk, preservation, or rollback path is incomplete.
The [release lifecycle architecture](../architecture/release-lifecycle.md)
defines promotion and incident gates.
