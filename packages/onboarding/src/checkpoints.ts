import {
  checkpointPlanSchema,
  gitInspectionSchema,
  restoreManifestSchema,
  type CheckpointPlan,
  type GitInspection,
  type RestoreManifest
} from "./contracts.js";

export function buildCheckpointPlan(input: {
  readonly projectId: string;
  readonly inspection: unknown;
}): CheckpointPlan {
  const inspection = gitInspectionSchema.parse(input.inspection);
  const suffix = input.projectId.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  const userWork = unique([...inspection.dirtyPaths, ...inspection.untrackedPaths]);
  const warnings = [
    ...(inspection.detached ? ["The repository is detached; the checkpoint starts from the observed commit."] : []),
    ...(inspection.nestedRepositories.length > 0
      ? ["Nested repositories remain outside the product checkpoint."]
      : []),
    ...(inspection.largeFiles.length > 0
      ? ["Large files remain excluded unless Git LFS is already configured."]
      : []),
    "Restore changes only files recorded as product-owned; unrelated user work is never deleted."
  ];

  if (!inspection.present) {
    return checkpointPlanSchema.parse({
      schemaVersion: 1,
      mode: "initialize_git",
      baseline: null,
      branch: `studio/${suffix}-first-checkpoint`,
      userWorkOutsideCheckpoint: userWork,
      protectedPaths: inspection.ignoredSensitivePaths,
      exactOperations: [
        "git init --initial-branch=main",
        "verify ignore rules and sensitive paths",
        "git add only approved baseline files",
        "git commit -m \"chore: save pre-pipeline checkpoint\"",
        `git switch -c studio/${suffix}-first-checkpoint`
      ],
      limitations: [
        "Git initialization and the baseline commit require explicit user approval.",
        ...warnings
      ],
      requiresApproval: true,
      reversible: true
    });
  }

  return checkpointPlanSchema.parse({
    schemaVersion: 1,
    mode: "existing_git",
    baseline: inspection.head,
    branch: `studio/${suffix}-checkpoint`,
    userWorkOutsideCheckpoint: userWork,
    protectedPaths: inspection.ignoredSensitivePaths,
    exactOperations: [
      `git worktree add -b studio/${suffix}-checkpoint <isolated-path> ${inspection.head}`,
      "apply product changes only inside the isolated worktree",
      "validate the isolated worktree",
      "commit only the declared product-owned files"
    ],
    limitations: warnings,
    requiresApproval: false,
    reversible: true
  });
}

export function createRestoreManifest(input: {
  readonly checkpointId: string;
  readonly baseline: string | null;
  readonly productOwnedFiles: RestoreManifest["productOwnedFiles"];
  readonly unrelatedUserPaths: readonly string[];
}): RestoreManifest {
  return restoreManifestSchema.parse({
    schemaVersion: 1,
    ...input,
    unrelatedUserPaths: unique(input.unrelatedUserPaths)
  });
}

export interface CheckpointGitAdapter {
  initialize(input: {
    readonly branch: string;
    readonly protectedPaths: readonly string[];
  }): Promise<{ readonly head: string; readonly branch: string }>;
  createIsolatedCheckpoint(input: {
    readonly baseline: string;
    readonly branch: string;
    readonly protectedPaths: readonly string[];
  }): Promise<{ readonly head: string; readonly branch: string }>;
  observe(): Promise<{ readonly head: string; readonly branch: string }>;
}

export async function executeCheckpointPlan(input: {
  readonly plan: unknown;
  readonly adapter: CheckpointGitAdapter;
  readonly approved: boolean;
}): Promise<{
  readonly observed: true;
  readonly baseline: string;
  readonly branch: string;
  readonly userWorkPreserved: readonly string[];
}> {
  const plan = checkpointPlanSchema.parse(input.plan);
  if (plan.requiresApproval && !input.approved) {
    throw new Error("This checkpoint operation requires explicit user approval.");
  }
  const result =
    plan.mode === "initialize_git"
      ? await input.adapter.initialize({
          branch: plan.branch,
          protectedPaths: plan.protectedPaths
        })
      : await input.adapter.createIsolatedCheckpoint({
          baseline: plan.baseline!,
          branch: plan.branch,
          protectedPaths: plan.protectedPaths
        });
  const observed = await input.adapter.observe();
  if (
    result.head !== observed.head
    || result.branch !== observed.branch
    || result.branch !== plan.branch
    || (plan.baseline !== null && result.head !== plan.baseline)
  ) {
    throw new Error("Checkpoint postcondition was not observed.");
  }
  return {
    observed: true,
    baseline: observed.head,
    branch: observed.branch,
    userWorkPreserved: plan.userWorkOutsideCheckpoint
  };
}

export function planRestore(input: {
  readonly manifest: unknown;
  readonly currentDigests: Readonly<Record<string, string | null>>;
}): {
  readonly safe: boolean;
  readonly restorePaths: readonly string[];
  readonly conflicts: readonly string[];
  readonly preservedUserPaths: readonly string[];
  readonly operations: readonly string[];
} {
  const manifest = restoreManifestSchema.parse(input.manifest);
  const restorePaths: string[] = [];
  const conflicts: string[] = [];
  for (const file of manifest.productOwnedFiles) {
    const current = input.currentDigests[file.path];
    if (current === undefined || current === file.afterSha256) {
      restorePaths.push(file.path);
    } else {
      conflicts.push(file.path);
    }
  }
  return {
    safe: conflicts.length === 0,
    restorePaths,
    conflicts,
    preservedUserPaths: manifest.unrelatedUserPaths,
    operations: restorePaths.map((path) =>
      manifest.productOwnedFiles.find((file) => file.path === path)?.beforeSha256 === null
        ? `remove product-created file ${path}`
        : `restore checkpoint content for ${path}`
    )
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
