# Manual delivery policy

Pipeline Studio does not use GitHub Actions, hosted CI, automated deployment,
scheduled repository workflows, or other GitHub-hosted compute during the
development and proof-of-concept stages.

## Current rule

- GitHub is source control and review storage only.
- Verification runs locally with `npm run verify` and `npm run studio:build`.
- Any requested deployment is performed directly from an explicitly selected
  controlled machine after local verification.
- Deployment credentials remain outside the repository and GitHub Actions.
- No push, merge, tag, or pull request triggers a deployment.
- CI/CD design and activation are deferred to the final release stage and
  require an explicit owner decision.

## Delivery record

Each manual deployment must record:

1. exact commit;
2. local verification result;
3. target environment;
4. operator approval;
5. observed post-deployment checks;
6. rollback method and outcome.

Until a deployment is explicitly requested, Pipeline Studio development stops
at a verified, pushed source checkpoint.
