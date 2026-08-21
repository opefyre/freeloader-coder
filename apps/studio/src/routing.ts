export type WorkspaceGroup = "primary" | "secondary";

export type WorkspaceDefinition = {
  path: string;
  label: string;
  mobileLabel: string;
  note: string;
  eyebrow: string;
  title: string;
  description: string;
  group: WorkspaceGroup;
  mobile: boolean;
};

export const workspaceDefinitions = {
  overview: {
    path: "/",
    label: "Start",
    mobileLabel: "Start",
    note: "Start a project",
    eyebrow: "Start",
    title: "What do you want to build?",
    description: "Describe the outcome and choose where the project lives.",
    group: "primary",
    mobile: true,
  },
  projects: {
    path: "/projects",
    label: "Projects",
    mobileLabel: "Projects",
    note: "Resources, progress, and files",
    eyebrow: "Projects",
    title: "Your projects",
    description: "Open a project to manage its resources and progress.",
    group: "primary",
    mobile: true,
  },
  conversation: {
    path: "/conversation",
    label: "Conversation",
    mobileLabel: "Chat",
    note: "Ask, clarify, and guide work",
    eyebrow: "Grounded in this project",
    title: "Build through conversation",
    description: "Describe outcomes, clarify intent, and guide the pipeline without losing execution context.",
    group: "primary",
    mobile: true,
  },
  work: {
    path: "/work",
    label: "Work",
    mobileLabel: "Work",
    note: "Active, queued, and verified tasks",
    eyebrow: "Live local coordination · $0 automatic spend",
    title: "Work that explains itself",
    description: "Inspect the canonical queue, safe next actions, schedules, leases, and approval boundaries.",
    group: "primary",
    mobile: true,
  },
  decisions: {
    path: "/decisions",
    label: "Decisions",
    mobileLabel: "Decide",
    note: "Approvals, blockers, and recovery choices",
    eyebrow: "Live local queue · Human authority preserved",
    title: "Know exactly what needs you",
    description: "Review approvals, missing input, failures, provider waits, and recovery choices in priority order.",
    group: "primary",
    mobile: true,
  },
  attention: {
    path: "/attention",
    label: "Attention",
    mobileLabel: "Alerts",
    note: "Durable alerts, snoozes, and quiet hours",
    eyebrow: "Live local attention · Quiet-aware",
    title: "Stay informed without the noise",
    description: "Triage canonical alerts, acknowledge what you have seen, snooze safely, and protect focus with local quiet hours.",
    group: "primary",
    mobile: true,
  },
  activity: {
    path: "/activity",
    label: "Action Center",
    mobileLabel: "Actions",
    note: "Things that need you",
    eyebrow: "Action Center",
    title: "Needs your attention",
    description: "Approve, decline, answer, or comment.",
    group: "primary",
    mobile: true,
  },
  providers: {
    path: "/providers",
    label: "Providers",
    mobileLabel: "Models",
    note: "Free routes and model health",
    eyebrow: "Free-provider mesh · Demo evidence",
    title: "Models working as one system",
    description: "Inspect routing, health, usage, fallbacks, and the evidence behind every provider claim.",
    group: "primary",
    mobile: true,
  },
  integrations: {
    path: "/integrations",
    label: "Connect",
    mobileLabel: "Connect",
    note: "GitHub and Jira workspaces",
    eyebrow: "GitHub + Jira · Demo connection",
    title: "Bring work in. Send proof back.",
    description: "Connect exact resources, ground selected work, and approve every external write before it happens.",
    group: "primary",
    mobile: true,
  },
  evidence: {
    path: "/evidence",
    label: "Evidence",
    mobileLabel: "Proof",
    note: "Checks, checkpoints, and sources",
    eyebrow: "Demo: 87 checks passed",
    title: "Trust, with receipts",
    description: "Review checkpoints, validations, sources, and recoverable proof before accepting a result.",
    group: "primary",
    mobile: true,
  },
  help: {
    path: "/help",
    label: "Help",
    mobileLabel: "Help",
    note: "Guidance, recovery, and support",
    eyebrow: "Offline · Product-aware · Safe to share",
    title: "Help that knows the workflow",
    description: "Learn, recover, and prepare support evidence without leaking sensitive data.",
    group: "primary",
    mobile: true,
  },
  launch: {
    path: "/launch",
    label: "Launch",
    mobileLabel: "Launch",
    note: "Positioning, demo, operations, and learning",
    eyebrow: "Local launch preview · No deployment",
    title: "Make the promise inspectable",
    description: "Explore the product story, safe failure demo, competitive boundary, launch gates, and learning evidence.",
    group: "secondary",
    mobile: false,
  },
  releases: {
    path: "/releases",
    label: "Releases",
    mobileLabel: "Releases",
    note: "Updates, compatibility, and rollout",
    eyebrow: "Candidate 0.8.0-beta.2 · Local verification",
    title: "Releases you can prove and undo",
    description: "Inspect artifacts, compatibility, updates, rollout gates, and incident recovery before publishing.",
    group: "secondary",
    mobile: false,
  },
  trust: {
    path: "/trust",
    label: "Trust",
    mobileLabel: "Trust",
    note: "Governance, supply chain, and data use",
    eyebrow: "Open source · Inspectable · No legal claim",
    title: "Trust that links back to source",
    description: "Inspect governance, release safeguards, data journeys, and responsible-AI choices in one place.",
    group: "secondary",
    mobile: false,
  },
  accessibility: {
    path: "/accessibility",
    label: "Accessibility",
    mobileLabel: "Access",
    note: "Release gates and foundation evidence",
    eyebrow: "WCAG 2.2 AA · Release-blocking evidence",
    title: "Accessibility is a release decision",
    description: "Inspect automated checks, named manual evidence, chart alternatives, and foundation proof before promotion.",
    group: "secondary",
    mobile: false,
  },
  settings: {
    path: "/settings",
    label: "Settings",
    mobileLabel: "Settings",
    note: "Connections, preferences, and safeguards",
    eyebrow: "Local-first configuration",
    title: "Set up your workspace",
    description: "Connect the apps and AI services Codkesh can use.",
    group: "secondary",
    mobile: false,
  },
} as const satisfies Record<string, WorkspaceDefinition>;

export type StudioView = keyof typeof workspaceDefinitions;

export type PrimaryStudioView = "overview" | "projects" | "activity" | "settings";

const primaryViewAliases: Readonly<Record<StudioView, PrimaryStudioView>> = {
  overview: "overview",
  projects: "projects",
  conversation: "overview",
  work: "activity",
  decisions: "activity",
  attention: "activity",
  activity: "activity",
  providers: "settings",
  integrations: "settings",
  evidence: "projects",
  help: "settings",
  launch: "projects",
  releases: "projects",
  trust: "settings",
  accessibility: "settings",
  settings: "settings",
};

export function primaryView(view: StudioView): PrimaryStudioView {
  return primaryViewAliases[view];
}

export const studioViews = Object.keys(workspaceDefinitions) as StudioView[];

export function validateWorkspaceRegistry(
  definitions: Readonly<Record<string, WorkspaceDefinition>>
): readonly string[] {
  const errors: string[] = [];
  const paths = new Set<string>();
  for (const [id, definition] of Object.entries(definitions)) {
    if (!id.trim()) errors.push("Workspace identity is empty.");
    if (!definition.path.startsWith("/")) errors.push(`${id}: path must be absolute.`);
    if (paths.has(definition.path)) errors.push(`${id}: duplicate path ${definition.path}.`);
    paths.add(definition.path);
    for (const field of ["label", "mobileLabel", "note", "eyebrow", "title", "description"] as const) {
      if (!definition[field].trim()) errors.push(`${id}: ${field} is empty.`);
    }
  }
  return errors;
}

const registryErrors = validateWorkspaceRegistry(workspaceDefinitions);
if (registryErrors.length > 0) {
  throw new Error(`Invalid Studio workspace registry: ${registryErrors.join(" ")}`);
}

export function workspaceDefinition(view: StudioView): WorkspaceDefinition {
  return workspaceDefinitions[view];
}

export function routeForView(view: StudioView): string {
  return workspaceDefinitions[view].path;
}

export function viewFromLocation(location: {
  readonly pathname: string;
  readonly search: string;
}): StudioView {
  const pathname = normalizePath(location.pathname);
  if (projectIdFromLocation(location)) return "projects";
  const legacyView = new URLSearchParams(location.search).get("view");
  if (pathname === "/" && studioViews.includes(legacyView as StudioView)) {
    return primaryView(legacyView as StudioView);
  }

  const route = studioViews.find(
    (view) => workspaceDefinitions[view].path === pathname
  );
  return route ? primaryView(route) : "overview";
}

export function canonicalStudioUrl(url: URL, view: StudioView): URL {
  const canonical = new URL(url);
  const destination = primaryView(view);
  const legacyProjectId = canonical.searchParams.get("project");
  const projectId = projectIdFromLocation(url) ?? (legacyProjectId && isProjectId(legacyProjectId) ? legacyProjectId : null);
  canonical.pathname = (destination === "projects" || (destination === "overview" && legacyProjectId)) && projectId
    ? projectRoute(projectId)
    : routeForView(destination);
  canonical.searchParams.delete("view");
  canonical.searchParams.delete("project");
  return canonical;
}

export function projectRoute(projectId: string): string {
  if (!isProjectId(projectId)) {
    throw new Error("Project route requires an opaque project identity.");
  }
  return `/projects/${projectId}`;
}

function isProjectId(value: string): boolean {
  return /^project_[a-f0-9]{16}$/.test(value);
}

export function projectIdFromLocation(location: { readonly pathname: string }): string | null {
  const match = normalizePath(location.pathname).match(/^\/projects\/(project_[a-f0-9]{16})$/);
  return match?.[1] ?? null;
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
