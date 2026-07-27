import "@fontsource-variable/geist";
import "../../../packages/ui/src/tokens.css";
import "./styles.css";

import {
  Activity,
  BadgeCheck,
  Bot,
  Boxes,
  ChevronRight,
  Coins,
  Command,
  createIcons,
  Eye,
  FileCheck2,
  Gauge,
  GitCommitHorizontal,
  History,
  LayoutGrid,
  ListFilter,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap
} from "lucide";

import {
  componentGallery,
  operationalStates,
  type DensityMode,
  type OperationalState,
  type PrimitiveKind
} from "../../../packages/ui/src/index.js";

const primitiveIcons: Record<PrimitiveKind, string> = {
  status: "Activity",
  evidence: "FileCheck2",
  approval: "ShieldCheck",
  risk: "TriangleAlert",
  cost: "Coins",
  provider: "Bot",
  task: "ListFilter",
  timeline: "History",
  preview: "Eye",
  recovery: "RotateCcw"
};

const stateLabels: Record<OperationalState, string> = {
  loading: "Loading",
  empty: "Empty",
  working: "Working",
  partial: "Partial",
  offline: "Offline",
  permission_denied: "Permission denied",
  quota_exhausted: "Quota exhausted",
  failed: "Failed",
  retrying: "Retrying",
  recovering: "Recovering",
  restored: "Restored",
  succeeded: "Succeeded"
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Studio app root is missing.");
const app: HTMLDivElement = appRoot;

let selectedState: OperationalState = "working";
let density: DensityMode = "guided";
let preview = "laptop";

function render(): void {
  const scenario = componentGallery.find(
    (entry) =>
      entry.state === selectedState &&
      entry.breakpoint === preview &&
      entry.density === density
  );
  if (!scenario) throw new Error("Selected gallery scenario is unavailable.");

  app.dataset.density = density;
  app.innerHTML = `
    <div class="ambient ambient-one" aria-hidden="true"></div>
    <div class="ambient ambient-two" aria-hidden="true"></div>
    <aside class="rail" aria-label="Primary navigation">
      <a class="brand ps-focusable" href="#" aria-label="Pipeline Studio home">
        <span class="brand-mark"><i data-lucide="Command" aria-hidden="true"></i></span>
        <span>Pipeline<br />Studio</span>
      </a>
      <nav class="rail-nav" aria-label="Workspace">
        ${navItem("LayoutGrid", "Control center", true)}
        ${navItem("ListFilter", "Runs")}
        ${navItem("Bot", "Providers")}
        ${navItem("ShieldCheck", "Evidence")}
      </nav>
      <button class="icon-button ps-focusable" type="button" aria-label="Open settings">
        <i data-lucide="Settings2" aria-hidden="true"></i>
      </button>
    </aside>

    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Foundation · DSGN-01-SYS</p>
          <h1>Visual system control room</h1>
        </div>
        <div class="top-actions">
          <button class="search ps-focusable" type="button">
            <i data-lucide="Search" aria-hidden="true"></i>
            <span>Search components</span><kbd>⌘ K</kbd>
          </button>
          <button class="avatar ps-focusable" type="button" aria-label="Open profile menu">OF</button>
        </div>
      </header>

      <section class="hero ps-surface" aria-labelledby="system-health">
        <div class="hero-copy">
          <div class="signal"><span></span> System language locked</div>
          <h2 id="system-health">One coherent system.<br /><em>Every operational truth.</em></h2>
          <p>Explore every state, surface, density, and recovery contract from one canonical source.</p>
        </div>
        <div class="orbit" aria-hidden="true">
          <div class="orbit-ring orbit-ring-one"></div>
          <div class="orbit-ring orbit-ring-two"></div>
          <div class="orbit-core"><i data-lucide="Sparkles"></i></div>
          <span class="orbit-node node-one"><i data-lucide="ShieldCheck"></i></span>
          <span class="orbit-node node-two"><i data-lucide="Zap"></i></span>
          <span class="orbit-node node-three"><i data-lucide="GitCommitHorizontal"></i></span>
        </div>
      </section>

      <section class="metrics" aria-label="Design system coverage">
        ${metric("Boxes", "10", "Primitive families", "Canonical contracts")}
        ${metric("LayoutGrid", "96", "Gallery scenarios", "Full state matrix")}
        ${metric("BadgeCheck", "46", "Verification checks", "All passing")}
        ${metric("Gauge", "4", "Responsive modes", "Mobile to wide")}
      </section>

      <section id="gallery" aria-labelledby="gallery-title">
        <div class="section-heading">
          <div><p class="eyebrow">Interactive gallery</p><h2 id="gallery-title">Operational primitives</h2></div>
          <div class="segmented" role="group" aria-label="Information density">
            ${densityButton("guided", "Guided")}
            ${densityButton("advanced", "Advanced")}
          </div>
        </div>

        <div class="state-scroller" role="tablist" aria-label="Operational state">
          ${operationalStates
            .map(
              (state) => `<button class="state-tab ps-focusable" type="button" role="tab"
                data-state="${state}" aria-selected="${state === selectedState}">
                <span class="state-dot tone-${toneName(state)}"></span>${stateLabels[state]}
              </button>`
            )
            .join("")}
        </div>

        <div class="gallery-frame ps-surface" data-preview="${preview}" aria-live="polite">
          <div class="frame-toolbar">
            <div class="frame-title">
              <span class="pulse tone-${toneName(selectedState)}"></span>
              <div><strong>${stateLabels[selectedState]}</strong><small>${scenario.name}</small></div>
            </div>
            <div class="breakpoints" role="group" aria-label="Preview breakpoint">
              ${breakpointButton("mobile", "M")}
              ${breakpointButton("tablet", "T")}
              ${breakpointButton("laptop", "L")}
              ${breakpointButton("wide", "W")}
            </div>
          </div>
          <div class="primitive-grid">${scenario.primitives.map(renderPrimitive).join("")}</div>
        </div>
      </section>

      <section class="evidence-strip ps-surface" aria-labelledby="evidence-title">
        <div class="evidence-icon"><i data-lucide="FileCheck2" aria-hidden="true"></i></div>
        <div>
          <p class="eyebrow">Observable evidence</p>
          <h2 id="evidence-title">The UI cannot claim what the system did not prove.</h2>
        </div>
        <div class="verification">
          <span><i data-lucide="BadgeCheck" aria-hidden="true"></i> Contracts valid</span>
          <span><i data-lucide="BadgeCheck" aria-hidden="true"></i> A11y fallbacks</span>
          <span><i data-lucide="BadgeCheck" aria-hidden="true"></i> Style lint</span>
        </div>
      </section>
    </main>`;

  createIcons({
    icons: {
      Activity,
      BadgeCheck,
      Bot,
      Boxes,
      ChevronRight,
      Coins,
      Command,
      Eye,
      FileCheck2,
      Gauge,
      GitCommitHorizontal,
      History,
      LayoutGrid,
      ListFilter,
      RotateCcw,
      Search,
      Settings2,
      ShieldCheck,
      Sparkles,
      TriangleAlert,
      Zap
    },
    attrs: { "stroke-width": "1.75" }
  });
  bindControls();
}

function navItem(icon: string, label: string, active = false): string {
  return `<a class="rail-link ps-focusable ${active ? "active" : ""}" href="#gallery" ${
    active ? 'aria-current="page"' : ""
  }><i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span></a>`;
}

function metric(icon: string, value: string, label: string, note: string): string {
  return `<article class="metric ps-surface">
    <span class="metric-icon"><i data-lucide="${icon}" aria-hidden="true"></i></span>
    <div><strong>${value}</strong><span>${label}</span></div><small>${note}</small>
  </article>`;
}

function densityButton(mode: DensityMode, label: string): string {
  return `<button class="ps-focusable" type="button" data-density-choice="${mode}"
    aria-pressed="${density === mode}">${label}</button>`;
}

function breakpointButton(mode: string, label: string): string {
  return `<button class="ps-focusable" type="button" data-breakpoint="${mode}"
    aria-pressed="${preview === mode}" aria-label="${mode} preview">${label}</button>`;
}

function toneName(state: OperationalState): string {
  if (["restored", "succeeded"].includes(state)) return "positive";
  if (["working", "retrying", "recovering"].includes(state)) return "active";
  if (["partial", "quota_exhausted"].includes(state)) return "caution";
  if (["offline", "permission_denied", "failed"].includes(state)) return "critical";
  return "neutral";
}

function renderPrimitive(primitive: (typeof componentGallery)[number]["primitives"][number]): string {
  const preserved = primitive.preservedWork
    ? `<p class="preserved"><i data-lucide="ShieldCheck" aria-hidden="true"></i>${primitive.preservedWork}</p>`
    : "";
  const recommended = primitive.recommendedAction
    ? `<p class="recommended"><i data-lucide="RotateCcw" aria-hidden="true"></i>${primitive.recommendedAction}</p>`
    : "";
  return `<article class="primitive">
    <div class="primitive-top">
      <span class="primitive-icon tone-${primitive.tone}">
        <i data-lucide="${primitiveIcons[primitive.kind]}" aria-hidden="true"></i>
      </span>
      <span class="state-pill tone-${primitive.tone}">${stateLabels[primitive.state]}</span>
    </div>
    <div><p class="primitive-kind">${primitive.kind}</p><h3>${primitive.title}</h3>
      <p>${primitive.summary}</p></div>
    ${preserved}
    ${recommended}
    <button class="text-action ps-focusable" type="button" aria-label="Inspect ${primitive.kind} contract">
      Inspect contract <i data-lucide="ChevronRight" aria-hidden="true"></i>
    </button>
  </article>`;
}

function bindControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-state]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedState = button.dataset.state as OperationalState;
      render();
    });
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-density-choice]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        density = button.dataset.densityChoice as DensityMode;
        render();
      });
    });
  document.querySelectorAll<HTMLButtonElement>("[data-breakpoint]").forEach((button) => {
    button.addEventListener("click", () => {
      preview = button.dataset.breakpoint ?? "laptop";
      render();
    });
  });
}

render();
