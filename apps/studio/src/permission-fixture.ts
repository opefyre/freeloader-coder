export type PermissionKind =
  | "Project folder"
  | "Provider"
  | "Connector"
  | "Tool"
  | "External effect"
  | "Paid action";

export type PermissionState = "Active" | "Expires soon" | "Revoked" | "Denied";

export interface PermissionProfile {
  readonly id: string;
  readonly kind: PermissionKind;
  readonly name: string;
  readonly summary: string;
  readonly project: string;
  readonly target: string;
  readonly maskedTarget: string;
  readonly access: string;
  readonly technicalScopes: readonly string[];
  readonly state: PermissionState;
  readonly expiresAt: string | null;
  readonly recentUse: string;
  readonly activeWork: number;
}

export const recommendedPermissionProfiles: readonly PermissionProfile[] = [
  {
    id: "project-folder",
    kind: "Project folder",
    name: "Main project files",
    summary: "Read the repository and write only inside the selected project.",
    project: "Main project",
    target: "Main project · local repository",
    maskedTarget: "Project folder · ••••",
    access: "Read and reversible local changes",
    technicalScopes: ["project.read", "project.write.scoped", "git.checkpoint"],
    state: "Active",
    expiresAt: null,
    recentUse: "Read package metadata · 4 minutes ago",
    activeWork: 1
  },
  {
    id: "providers",
    kind: "Provider",
    name: "Free model providers",
    summary: "Use admitted free routes through credential references; never reveal keys.",
    project: "Main project",
    target: "4 admitted free-provider connections",
    maskedTarget: "Provider connections · 4 active",
    access: "Model requests using non-personal test data",
    technicalScopes: ["provider.invoke.free", "provider.quota.read", "vault.reference.use"],
    state: "Active",
    expiresAt: null,
    recentUse: "Groq completed a planning call · 12 minutes ago",
    activeWork: 0
  },
  {
    id: "jira",
    kind: "Connector",
    name: "Jira planning",
    summary: "Read PIPE work and update only tickets selected by the active plan.",
    project: "Main project",
    target: "PIPE project · Opefyre Jira",
    maskedTarget: "Jira project · ••••",
    access: "Read issues and perform reversible status/comment updates",
    technicalScopes: ["jira.issue.read", "jira.issue.comment", "jira.issue.transition"],
    state: "Active",
    expiresAt: null,
    recentUse: "Added a sprint implementation comment · 2 minutes ago",
    activeWork: 0
  },
  {
    id: "git-tools",
    kind: "Tool",
    name: "Git checkpoints",
    summary: "Inspect diffs and create local commits after deterministic validation.",
    project: "Main project",
    target: "Current local Git repository",
    maskedTarget: "Local Git repository · ••••",
    access: "Local reversible checkpoints",
    technicalScopes: ["git.diff.read", "git.commit.local"],
    state: "Active",
    expiresAt: null,
    recentUse: "Created a verified local checkpoint · 18 minutes ago",
    activeWork: 0
  },
  {
    id: "external-effects",
    kind: "External effect",
    name: "External consequential changes",
    summary: "Always ask before publishing, merging, deploying, or contacting another person.",
    project: "Main project",
    target: "Connected external services",
    maskedTarget: "External services · approval required",
    access: "Approval required for each consequential effect",
    technicalScopes: ["external.write.approval_required"],
    state: "Active",
    expiresAt: null,
    recentUse: "No consequential external effect used",
    activeWork: 0
  },
  {
    id: "paid-actions",
    kind: "Paid action",
    name: "Paid services",
    summary: "Automatic paid usage is disabled and cannot be enabled by a model or plugin.",
    project: "Main project",
    target: "All provider and infrastructure billing",
    maskedTarget: "All paid services",
    access: "Denied by free-only policy",
    technicalScopes: ["cost.paid.denied"],
    state: "Denied",
    expiresAt: null,
    recentUse: "No paid action has been authorized",
    activeWork: 0
  }
] as const;

export type PermissionAction = "revoke" | "expire" | "reset";

export interface PermissionActionResult {
  readonly profile: PermissionProfile;
  readonly notice: string;
}

export function applyPermissionAction(
  profile: PermissionProfile,
  action: PermissionAction
): PermissionActionResult {
  if (action === "reset") {
    const recommended = recommendedPermissionProfiles.find(
      (candidate) => candidate.id === profile.id
    );
    if (!recommended) throw new Error("Recommended permission profile is missing.");
    return {
      profile: recommended,
      notice: `${profile.name} was reset to the recommended project policy.`
    };
  }
  if (action === "expire") {
    if (profile.state === "Denied") {
      return {
        profile,
        notice: "Paid actions remain denied; there is no active grant to expire."
      };
    }
    return {
      profile: {
        ...profile,
        state: "Expires soon",
        expiresAt: "In 24 hours"
      },
      notice: `${profile.name} will expire in 24 hours. New work will stop at expiry.`
    };
  }
  if (profile.state === "Denied") {
    return {
      profile,
      notice: "Paid actions are already denied."
    };
  }
  return {
    profile: {
      ...profile,
      state: "Revoked",
      expiresAt: null,
      activeWork: 0,
      recentUse: profile.activeWork > 0
        ? "Revoked now · active work will pause after its current safe step"
        : "Revoked now · no active work required reconciliation"
    },
    notice: profile.activeWork > 0
      ? `${profile.name} was revoked. New work is blocked; active work will pause after its current safe step.`
      : `${profile.name} was revoked. New work is blocked immediately.`
  };
}

export function visiblePermissionTarget(
  profile: PermissionProfile,
  privacyScreen: boolean
): string {
  return privacyScreen ? profile.maskedTarget : profile.target;
}
