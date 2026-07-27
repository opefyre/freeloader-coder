import type { DensityMode } from "./tokens.js";

export const workspaceSurfaces = [
  "control",
  "conversation",
  "tasks",
  "decisions",
  "checkpoints",
  "preview",
  "restore",
  "help"
] as const;
export type WorkspaceSurface = (typeof workspaceSurfaces)[number];

export const detailPanels = ["summary", "evidence", "activity", "technical"] as const;
export type DetailPanel = (typeof detailPanels)[number];

export const navigationSituations = [
  "first_run",
  "empty",
  "busy",
  "interrupted",
  "needs_you",
  "multi_project"
] as const;
export type NavigationSituation = (typeof navigationSituations)[number];

export interface WorkspaceLocation {
  projectId: string;
  surface: WorkspaceSurface;
  resourceId?: string;
  density: DensityMode;
  panel: DetailPanel;
}

export interface NavigationDestination {
  id: WorkspaceSurface;
  label: string;
  description: string;
  group: "primary" | "context" | "support";
  attention: "none" | "status" | "decision";
}

export interface WorkspaceNavigation {
  situation: NavigationSituation;
  density: DensityMode;
  highlighted: WorkspaceSurface;
  notice: string;
  destinations: readonly NavigationDestination[];
  technicalDetailsVisible: boolean;
}

const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const allowedSearchKeys = new Set(["density", "panel"]);
const resourceSurfaces = new Set<WorkspaceSurface>([
  "conversation",
  "tasks",
  "decisions",
  "checkpoints",
  "preview",
  "restore"
]);

export const navigationDestinations: readonly NavigationDestination[] = [
  {
    id: "control",
    label: "Control center",
    description: "See current work, health, and what needs attention.",
    group: "primary",
    attention: "status"
  },
  {
    id: "conversation",
    label: "Conversation",
    description: "Ask for work, clarify intent, and review the plan.",
    group: "primary",
    attention: "none"
  },
  {
    id: "tasks",
    label: "Current work",
    description: "Follow active, queued, completed, and blocked tasks.",
    group: "primary",
    attention: "status"
  },
  {
    id: "decisions",
    label: "Needs you",
    description: "Review only decisions that cannot be resolved safely.",
    group: "context",
    attention: "decision"
  },
  {
    id: "checkpoints",
    label: "Checkpoints",
    description: "Inspect verified restore points and their evidence.",
    group: "context",
    attention: "none"
  },
  {
    id: "preview",
    label: "Preview",
    description: "See the current result without losing task context.",
    group: "primary",
    attention: "none"
  },
  {
    id: "restore",
    label: "Restore",
    description: "Return to a verified checkpoint through a guarded flow.",
    group: "context",
    attention: "none"
  },
  {
    id: "help",
    label: "Help",
    description: "Get the recommended fix and optional technical detail.",
    group: "support",
    attention: "none"
  }
];

export function buildWorkspaceHref(location: WorkspaceLocation): string {
  validateLocation(location);
  const resource = location.resourceId
    ? `/${encodeURIComponent(location.resourceId)}`
    : "";
  const search = new URLSearchParams();
  if (location.density === "advanced") search.set("density", "advanced");
  if (location.panel !== "summary") search.set("panel", location.panel);
  const query = search.toString();
  return `/workspace/${encodeURIComponent(location.projectId)}/${location.surface}${resource}${
    query ? `?${query}` : ""
  }`;
}

export function parseWorkspaceHref(href: string): WorkspaceLocation {
  if (!href.startsWith("/") || href.startsWith("//")) {
    throw new Error("Workspace links must be local paths.");
  }
  const url = new URL(href, "http://pipeline-studio.local");
  if (url.hash) throw new Error("Workspace links do not support fragments.");
  for (const key of url.searchParams.keys()) {
    if (!allowedSearchKeys.has(key)) throw new Error(`Unsupported link field: ${key}`);
  }
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "workspace" || segments.length < 3 || segments.length > 4) {
    throw new Error("Workspace link shape is invalid.");
  }
  const projectId = segments[1] ?? "";
  const surface = segments[2] as WorkspaceSurface;
  const resourceId = segments[3];
  if (!workspaceSurfaces.includes(surface)) throw new Error("Unknown workspace surface.");

  const densityValue = url.searchParams.get("density") ?? "guided";
  if (densityValue !== "guided" && densityValue !== "advanced") {
    throw new Error("Unknown density mode.");
  }
  const panelValue = url.searchParams.get("panel") ?? "summary";
  if (!detailPanels.includes(panelValue as DetailPanel)) {
    throw new Error("Unknown detail panel.");
  }

  const location: WorkspaceLocation = {
    projectId,
    surface,
    density: densityValue,
    panel: panelValue as DetailPanel,
    ...(resourceId ? { resourceId } : {})
  };
  validateLocation(location);
  return location;
}

export function workspaceNavigationFor(
  situation: NavigationSituation,
  density: DensityMode
): WorkspaceNavigation {
  const state: Record<
    NavigationSituation,
    { highlighted: WorkspaceSurface; notice: string }
  > = {
    first_run: {
      highlighted: "conversation",
      notice: "Start with what you want to build. Setup appears only when it is needed."
    },
    empty: {
      highlighted: "conversation",
      notice: "No work is queued. Describe a goal or choose a suggested next step."
    },
    busy: {
      highlighted: "tasks",
      notice: "Work is active. You can leave this view without interrupting it."
    },
    interrupted: {
      highlighted: "restore",
      notice: "Work stopped safely. Your changes are preserved and recovery is ready."
    },
    needs_you: {
      highlighted: "decisions",
      notice: "One decision needs you before safe work can continue."
    },
    multi_project: {
      highlighted: "control",
      notice: "Choose a project; active work continues independently in the background."
    }
  };
  const selected = state[situation];
  return {
    situation,
    density,
    highlighted: selected.highlighted,
    notice: selected.notice,
    destinations: navigationDestinations,
    technicalDetailsVisible: density === "advanced"
  };
}

function validateLocation(location: WorkspaceLocation): void {
  if (!safeId.test(location.projectId)) throw new Error("Project identifier is unsafe.");
  if (!workspaceSurfaces.includes(location.surface)) throw new Error("Unknown workspace surface.");
  if (location.resourceId && !safeId.test(location.resourceId)) {
    throw new Error("Resource identifier is unsafe.");
  }
  if (location.resourceId && !resourceSurfaces.has(location.surface)) {
    throw new Error("This workspace surface cannot address a resource.");
  }
  if (!location.resourceId && resourceSurfaces.has(location.surface)) {
    throw new Error("This workspace surface requires a resource.");
  }
  if (!detailPanels.includes(location.panel)) throw new Error("Unknown detail panel.");
  if (location.panel === "technical" && location.density !== "advanced") {
    throw new Error("Technical details require Advanced density.");
  }
}
