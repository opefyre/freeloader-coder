# Publish verified work

Publishing is a separate external effect. A verified local result is not
automatically permission to push, create a pull request, update Jira, or deploy.

Before publishing, confirm:

1. the exact repository, remote, branch, and commit;
2. the intended pull request or direct-push policy;
3. the attached validation and review evidence;
4. the external Jira or GitHub changes;
5. that no credential, generated secret, or private diagnostic entered the diff.

Approve the displayed effect once. Pipeline Studio then verifies the remote
commit, pull request, or issue update before reporting success. Repeated requests
use idempotency keys and must not create duplicates.

Keep the verified commit local when repository identity, authorization, branch
protection, or destination is uncertain. CI/CD and deployment are optional and
must not be enabled merely to publish source.
