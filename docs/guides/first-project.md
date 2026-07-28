# Add your first project

Pipeline Studio can register an existing local repository or clone one from
GitHub. Registration begins with read-only inspection. It does not relocate,
overwrite, commit, or publish source code.

## Existing local repository

1. Open **Projects** and choose **Local folder**.
2. Select the repository root, not a parent containing several repositories.
3. Review detected languages, package tools, test commands, current Git state,
   and unsupported-layout warnings.
4. Confirm the project record only when those facts match the repository.

## Clone from GitHub

1. Connect GitHub with access limited to the intended repository.
2. Choose **Clone from GitHub** and review the account, repository, branch, and
   local destination.
3. If the destination exists, Pipeline Studio must offer refresh, a different
   destination, or cancellation. It must not overwrite it.
4. Continue only after the clone is verified and a checkpoint can be created.

## Safe alternative

If the layout cannot be understood, keep the repository unchanged. Use the
compatibility explanation to select the correct root or perform the unsupported
setup outside Pipeline Studio, then run inspection again.

See [plans and approvals](plans-and-approvals.md) before starting work.
