import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Command,
  createIcons,
  Eye,
  FileCheck2,
  GitBranch,
  House,
  ListTodo,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRoundCheck
} from "lucide";

import {
  buildWorkspaceHref,
  parseWorkspaceHref,
  workspaceNavigationFor,
  type DensityMode,
  type NavigationSituation,
  type WorkspaceLocation,
  type WorkspaceSurface
} from "../../../packages/ui/src/index.js";

const projectId = "freeloader-coder";
const activeTaskId = "PIPE-33";
const resourceBySurface: Partial<Record<WorkspaceSurface, string>> = {
  conversation: "welcome",
  tasks: activeTaskId,
  decisions: "decision-7",
  checkpoints: "checkpoint-18",
  preview: "preview-33",
  restore: "checkpoint-18"
};

const surfaceIcons: Record<WorkspaceSurface, string> = {
  control: "House",
  conversation: "MessageSquareText",
  tasks: "ListTodo",
  decisions: "UserRoundCheck",
  checkpoints: "ShieldCheck",
  preview: "Eye",
  restore: "RotateCcw",
  help: "CircleHelp"
};

let density: DensityMode = "guided";
let situation: NavigationSituation = "busy";
let locationState: WorkspaceLocation = safeLocation(window.location.pathname + window.location.search);

export function renderWorkspace(app: HTMLDivElement): void {
  density = locationState.density;
  const navigation = workspaceNavigationFor(situation, density);
  app.dataset.density = density;
  app.innerHTML = `
    <div class="ambient ambient-one" aria-hidden="true"></div>
    <div class="ambient ambient-two" aria-hidden="true"></div>
    <div class="workspace-frame">
      <aside class="workspace-sidebar" aria-label="Pipeline Studio">
        <a class="workspace-brand ps-focusable" href="${hrefFor("control")}" data-workspace-link>
          <span class="brand-mark"><i data-lucide="Command" aria-hidden="true"></i></span>
          <span><strong>Pipeline</strong><small>Studio</small></span>
        </a>
        <button class="project-switcher ps-focusable" type="button" aria-label="Switch project">
          <span class="project-avatar">FC</span>
          <span><strong>Freeloader Coder</strong><small>1 task running</small></span>
          <i data-lucide="ChevronDown" aria-hidden="true"></i>
        </button>
        <nav class="workspace-nav" aria-label="Workspace">
          ${navigation.destinations
            .filter((destination) => destination.group !== "support")
            .map(
              (destination) => `
              <a class="workspace-nav-link ps-focusable ${locationState.surface === destination.id ? "active" : ""}"
                href="${hrefFor(destination.id)}" data-workspace-link
                ${locationState.surface === destination.id ? 'aria-current="page"' : ""}>
                <i data-lucide="${surfaceIcons[destination.id]}" aria-hidden="true"></i>
                <span>${destination.label}</span>
                ${destination.id === "decisions" ? '<b aria-label="1 decision waiting">1</b>' : ""}
                ${destination.id === "tasks" ? '<span class="live-dot" aria-label="Work active"></span>' : ""}
              </a>`
            )
            .join("")}
        </nav>
        <div class="sidebar-bottom">
          <a class="workspace-nav-link ps-focusable ${locationState.surface === "help" ? "active" : ""}"
            href="${hrefFor("help")}" data-workspace-link>
            <i data-lucide="CircleHelp" aria-hidden="true"></i><span>Help & setup</span>
          </a>
          <a class="design-system-link ps-focusable" href="/design-system">
            <i data-lucide="Sparkles" aria-hidden="true"></i><span>Design system</span>
          </a>
        </div>
      </aside>

      <main class="workspace-main" id="workspace-main">
        <header class="workspace-topbar">
          <div>
            <p class="workspace-kicker">${surfaceTitle(locationState.surface).kicker}<span class="fixture-badge">Demo data</span></p>
            <h1>${surfaceTitle(locationState.surface).title}</h1>
          </div>
          <div class="workspace-actions">
            <button class="command-search ps-focusable" type="button" data-command-open aria-label="Find anything">
              <i data-lucide="Search" aria-hidden="true"></i><span>Find anything</span><kbd>⌘ K</kbd>
            </button>
            <div class="segmented" role="group" aria-label="Information density">
              ${densityButton("guided", "Guided")}
              ${densityButton("advanced", "Advanced")}
            </div>
            <button class="avatar ps-focusable" type="button" aria-label="Open profile menu">OF</button>
          </div>
        </header>

        <section class="workspace-notice" aria-live="polite">
          <span class="notice-orb"><i data-lucide="${situation === "needs_you" ? "TriangleAlert" : "Activity"}" aria-hidden="true"></i></span>
          <p>${navigation.notice}</p>
          <button class="text-action ps-focusable" type="button" data-situation-cycle>View next state <i data-lucide="ArrowRight"></i></button>
        </section>

        ${renderSurface(locationState.surface, navigation.technicalDetailsVisible)}
      </main>

      <aside class="activity-dock" aria-label="Live activity">
        <div class="dock-heading">
          <div><span class="live-dot"></span><strong>Live work</strong><small class="fixture-badge">Demo</small></div>
          <button class="icon-button ps-focusable" type="button" aria-label="Pause after current step"><i data-lucide="Pause"></i></button>
        </div>
        <section class="active-run">
          <div class="run-topline"><span>PIPE-33</span><span>68%</span></div>
          <h2>Build the workspace navigation shell</h2>
          <p>Implementing responsive routes and keyboard behavior.</p>
          <div class="progress-track"><span style="width:68%"></span></div>
          <div class="run-agent"><span class="agent-avatar"><i data-lucide="Bot"></i></span><span><strong>Interface builder</strong><small>Working · 4m</small></span></div>
        </section>
        <div class="activity-stream" aria-label="Recent verified activity">
          ${activity("Check", "Navigation contracts", "51 checks passed", "positive")}
          ${activity("GitBranch", "Public repository", "main published", "info")}
          ${activity("FileCheck2", "Evidence bundle", "Fresh clone verified", "positive")}
          ${activity("Clock3", "Next checkpoint", "After responsive QA", "neutral")}
        </div>
        <a class="dock-cta ps-focusable" href="${hrefFor("tasks")}" data-workspace-link>Open full task <i data-lucide="ArrowRight"></i></a>
      </aside>
    </div>
    <div class="command-palette" hidden data-command-palette>
      <button class="command-backdrop" type="button" aria-label="Close command menu" data-command-close></button>
      <section role="dialog" aria-modal="true" aria-label="Find anything">
        <div class="command-input"><i data-lucide="Search"></i><input aria-label="Search commands" placeholder="Jump to a task, decision, or project…" /></div>
        <p>Quick destinations</p>
        ${navigation.destinations
          .slice(0, 5)
          .map(
            (destination) =>
              `<a href="${hrefFor(destination.id)}" data-workspace-link><i data-lucide="${surfaceIcons[destination.id]}"></i><span><strong>${destination.label}</strong><small>${destination.description}</small></span><kbd>↵</kbd></a>`
          )
          .join("")}
      </section>
    </div>`;

  createIcons({
    icons: {
      Activity,
      ArrowRight,
      Bot,
      Check,
      ChevronDown,
      CircleHelp,
      Clock3,
      Command,
      Eye,
      FileCheck2,
      GitBranch,
      House,
      ListTodo,
      MessageSquareText,
      Pause,
      Play,
      RefreshCw,
      RotateCcw,
      Search,
      ShieldCheck,
      Sparkles,
      TriangleAlert,
      UserRoundCheck
    },
    attrs: { "stroke-width": "1.75" }
  });
  bindWorkspace(app);
}

function renderSurface(surface: WorkspaceSurface, technicalVisible: boolean): string {
  if (surface !== "control") {
    return `<section class="surface-placeholder ps-surface">
      <span class="surface-icon"><i data-lucide="${surfaceIcons[surface]}"></i></span>
      <p class="eyebrow">${surfaceTitle(surface).kicker}</p>
      <h2>${surfaceTitle(surface).title}</h2>
      <p>${surfaceTitle(surface).description}</p>
      <a class="primary-action ps-focusable" href="${hrefFor("control")}" data-workspace-link>Back to control center <i data-lucide="ArrowRight"></i></a>
    </section>`;
  }

  return `<div class="control-grid">
    <section class="command-hero ps-surface">
      <div class="command-copy">
        <span class="status-chip"><span class="live-dot"></span> Autonomous work is healthy</span>
        <h2>Your build is moving.<br /><em>One decision needs you.</em></h2>
        <p>The pipeline is implementing the navigation shell while preserving every verified checkpoint.</p>
        <div class="hero-actions">
          <a class="primary-action ps-focusable" href="${hrefFor("preview")}" data-workspace-link><i data-lucide="Eye"></i> Open preview</a>
          <a class="secondary-action ps-focusable" href="${hrefFor("tasks")}" data-workspace-link>See current work <i data-lucide="ArrowRight"></i></a>
        </div>
      </div>
      <div class="pulse-map" aria-label="Pipeline stages: plan complete, build active, verify pending, review pending">
        ${stage("Plan", "complete", "Check")}
        ${stage("Build", "active", "Bot")}
        ${stage("Verify", "next", "ShieldCheck")}
        ${stage("Review", "next", "Eye")}
      </div>
    </section>

    <section class="decision-card ps-surface">
      <div class="card-heading"><span class="card-icon caution"><i data-lucide="UserRoundCheck"></i></span><span><small>NEEDS YOU</small><h2>Choose the public product name</h2></span></div>
      <p>The repository is “Freeloader Coder,” while the product currently says “Pipeline Studio.” Work can continue safely without this choice.</p>
      <div class="decision-options">
        <button class="option-button ps-focusable" type="button">Keep Pipeline Studio <small>Clear, credible product name</small></button>
        <button class="option-button ps-focusable" type="button">Use Freeloader Coder <small>Matches the public repository</small></button>
      </div>
      <a href="${hrefFor("decisions")}" class="text-action ps-focusable" data-workspace-link>Review with context <i data-lucide="ArrowRight"></i></a>
    </section>

    <section class="proof-card ps-surface">
      <div class="card-heading"><span class="card-icon positive"><i data-lucide="ShieldCheck"></i></span><span><small>LAST VERIFIED</small><h2>Public history is clean</h2></span></div>
      <div class="proof-score"><strong>51</strong><span>checks passed</span><i data-lucide="Check"></i></div>
      <div class="proof-list">
        <span><i data-lucide="Check"></i> Fresh-clone install</span>
        <span><i data-lucide="Check"></i> Production build</span>
        <span><i data-lucide="Check"></i> Private references excluded</span>
      </div>
      <a href="https://github.com/opefyre/freeloader-coder" target="_blank" rel="noreferrer" class="text-action ps-focusable">Open GitHub <i data-lucide="ArrowRight"></i></a>
    </section>

    <section class="queue-card ps-surface">
      <div class="section-heading compact"><div><p class="eyebrow">Work queue</p><h2>What happens next</h2></div><span class="queue-count">3 ready</span></div>
      ${queueItem("PIPE-33", "Workspace navigation shell", "Building now", "active")}
      ${queueItem("PIPE-34", "Conversation-first command surface", "Ready next", "ready")}
      ${queueItem("PIPE-35", "Trustworthy task timeline", "After PIPE-34", "waiting")}
      <a href="${hrefFor("tasks")}" class="dock-cta ps-focusable" data-workspace-link>Open task queue <i data-lucide="ArrowRight"></i></a>
    </section>

    ${technicalVisible ? `<section class="technical-card ps-surface">
      <div><p class="eyebrow">Advanced detail</p><h2>Runtime snapshot</h2></div>
      <code>branch main</code><code>public sync verified</code><code>checks 51/51</code><code>build verified</code>
    </section>` : ""}
  </div>`;
}

function hrefFor(surface: WorkspaceSurface): string {
  return buildWorkspaceHref({
    projectId,
    surface,
    density,
    panel: "summary",
    ...(resourceBySurface[surface] ? { resourceId: resourceBySurface[surface] } : {})
  });
}

function safeLocation(href: string): WorkspaceLocation {
  try {
    return parseWorkspaceHref(href);
  } catch {
    return {
      projectId,
      surface: "control",
      density: "guided",
      panel: "summary"
    };
  }
}

function densityButton(mode: DensityMode, label: string): string {
  return `<button class="ps-focusable" type="button" data-density-choice="${mode}" aria-pressed="${density === mode}">${label}</button>`;
}

function activity(icon: string, title: string, note: string, tone: string): string {
  return `<article><span class="activity-icon ${tone}"><i data-lucide="${icon}"></i></span><span><strong>${title}</strong><small>${note}</small></span></article>`;
}

function stage(label: string, state: string, icon: string): string {
  return `<div class="pipeline-stage ${state}"><span><i data-lucide="${icon}"></i></span><strong>${label}</strong><small>${state === "complete" ? "Done" : state === "active" ? "In progress" : "Queued"}</small></div>`;
}

function queueItem(id: string, title: string, status: string, state: string): string {
  return `<article class="queue-item"><span class="queue-state ${state}"></span><span><small>${id}</small><strong>${title}</strong></span><em>${status}</em></article>`;
}

function surfaceTitle(surface: WorkspaceSurface): { kicker: string; title: string; description: string } {
  const labels: Record<WorkspaceSurface, { kicker: string; title: string; description: string }> = {
    control: { kicker: "Freeloader Coder", title: "Control center", description: "Everything important, without operational noise." },
    conversation: { kicker: "Create with intent", title: "Conversation", description: "Describe what you want to build, clarify the plan, and guide the work in plain language." },
    tasks: { kicker: activeTaskId, title: "Current work", description: "Follow active, queued, completed, and blocked work with evidence for every claim." },
    decisions: { kicker: "One item waiting", title: "Needs you", description: "Only choices the pipeline cannot make safely appear here, with impact and recommended options." },
    checkpoints: { kicker: "Verified restore points", title: "Checkpoints", description: "Inspect preserved states, validation evidence, and exactly what each checkpoint contains." },
    preview: { kicker: "Live result", title: "Preview", description: "Review the current result without interrupting the task or losing its context." },
    restore: { kicker: "Safe recovery", title: "Restore", description: "Return to a verified checkpoint through a guarded, fully explained recovery flow." },
    help: { kicker: "Recommended next step", title: "Help & setup", description: "Resolve provider, project, and pipeline issues with guided instructions and optional technical detail." }
  };
  return labels[surface];
}

function bindWorkspace(app: HTMLDivElement): void {
  app.querySelectorAll<HTMLAnchorElement>("[data-workspace-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      locationState = safeLocation(link.pathname + link.search);
      history.pushState({}, "", link.href);
      renderWorkspace(app);
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-density-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      density = button.dataset.densityChoice as DensityMode;
      locationState = { ...locationState, density, ...(density === "guided" && locationState.panel === "technical" ? { panel: "summary" as const } : {}) };
      history.replaceState({}, "", buildWorkspaceHref(locationState));
      renderWorkspace(app);
    });
  });

  app.querySelector<HTMLButtonElement>("[data-situation-cycle]")?.addEventListener("click", () => {
    const situations: NavigationSituation[] = ["busy", "needs_you", "interrupted", "empty"];
    const next = (situations.indexOf(situation) + 1) % situations.length;
    situation = situations[next] ?? "busy";
    renderWorkspace(app);
  });

  const palette = app.querySelector<HTMLElement>("[data-command-palette]");
  const openPalette = (): void => {
    if (!palette) return;
    palette.hidden = false;
    palette.querySelector<HTMLInputElement>("input")?.focus();
  };
  const closePalette = (): void => {
    if (palette) palette.hidden = true;
  };
  app.querySelector("[data-command-open]")?.addEventListener("click", openPalette);
  app.querySelector("[data-command-close]")?.addEventListener("click", closePalette);
  document.onkeydown = (event): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
    }
    if (event.key === "Escape") closePalette();
  };
  window.onpopstate = (): void => {
    locationState = safeLocation(window.location.pathname + window.location.search);
    renderWorkspace(app);
  };
}
