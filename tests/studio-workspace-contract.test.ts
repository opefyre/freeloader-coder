import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace exposes exactly four primary owner destinations", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  for (const label of [
    "Start",
    "Projects",
    "Action Center",
    "Settings"
  ]) {
    assert.match(await readFile("apps/studio/src/routing.ts", "utf8"), new RegExp(label));
  }
  assert.match(
    source,
    /primaryStudioViews\s*=\s*\[\s*"overview",\s*"projects",\s*"activity",\s*"settings",?\s*\]/,
  );
  assert.match(source, /aria-current=/);
  assert.match(source, /window\.history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(source, /window\.addEventListener\("popstate"/);
  assert.doesNotMatch(source, /Build workspace view/);
  assert.doesNotMatch(source, /Codkesh coding canvas/);
});

test("start page is a minimal prompt-first project entry", async () => {
  const [source, routing] = await Promise.all([
    readFile("apps/studio/src/App.tsx", "utf8"),
    readFile("apps/studio/src/routing.ts", "utf8"),
  ]);
  const composer = await readFile("apps/studio/src/components/conversation/local-request-panel.tsx", "utf8");
  assert.match(routing, /What do you want to build\?/);
  assert.match(source, /LocalRequestPanel/);
  assert.match(composer, /Describe your idea… or drop files here/);
  assert.match(composer, /Choose folder/);
  assert.match(composer, /Attach files/);
  assert.match(composer, /LocalVoiceInput/);
  assert.doesNotMatch(source, /Canvas needs a wider screen/);
});

test("workspace provides dedicated start, projects, action, and settings surfaces", async () => {
  const [source, routing] = await Promise.all([
    readFile("apps/studio/src/App.tsx", "utf8"),
    readFile("apps/studio/src/routing.ts", "utf8"),
  ]);
  const shellContract = `${source}\n${routing}`;
  for (const title of [
    "What do you want to build?",
    "Your projects",
    "Needs your attention",
    "Set up your workspace",
  ]) {
    assert.match(shellContract, new RegExp(title));
  }
  assert.match(source, /onClick=\{\(\) => navigate\(item\.id\)\}/);
  assert.match(
    source,
    /ProjectActivityDashboard\s+endpoint=\{endpoint\}\s+mode="actions"/,
  );
  assert.doesNotMatch(source, /TabsTrigger value="analytics"/);
});

test("projects provide real overview, resources, and project-scoped progress", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  const settings = await readFile("apps/studio/src/components/projects/project-resource-settings-v2.tsx", "utf8");
  assert.match(source, /TabsTrigger value="overview">Overview/);
  assert.match(source, /TabsTrigger value="resources">Resources/);
  assert.match(source, /TabsTrigger value="progress">Progress/);
  assert.match(
    source,
    /ProjectActivityDashboard\s+endpoint=\{endpoint\}\s+mode="analytics"\s+projectId=\{selectedProjectId\}/,
  );
  assert.match(settings, /setLocalProjectResources/);
  assert.match(settings, /listIntegrationConnections/);
  assert.match(settings, /expectedRevision: project\.resourceRevision/);
  assert.match(settings, /Search \$\{slot\.label\.toLowerCase\(\)\}…/);
  assert.match(settings, /aria-multiselectable=\{slot\.multiple/);
  assert.match(settings, /\["slack", "discord", "telegram"\]/);
  assert.match(settings, /label: "Hosting"/);
  assert.match(settings, /label: "Database"/);
  assert.match(settings, /label: "Storage"/);
  assert.match(settings, /Dialog\.Popup/);
  assert.doesNotMatch(settings, /position: absolute|className="absolute/);
});

test("workspace renders the shared approval pattern with all required decision facts", async () => {
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.match(source, /contentPatternExamples\.approval/);
  assert.match(source, /approvalFacts\(approval\)/);
  assert.match(source, /Before I act/);
  assert.match(source, /Every approval uses the same five decision facts/);
  assert.match(source, /No local or external effect is connected/);
});

test("workspace renders provider evidence as interactive, explicitly demo-scoped telemetry", async () => {
  const workspace = await readFile("apps/studio/src/App.tsx", "utf8");
  const fixture = await readFile("apps/studio/src/runtime-fixture.ts", "utf8");
  assert.match(workspace, /Provider mesh · demo evidence/);
  assert.match(workspace, /data-provider-id/);
  assert.match(workspace, /successfulProviderCalls/);
  assert.match(fixture, /buildProviderTelemetry/);
  assert.match(fixture, /routeEvidenceSummary/);
  assert.match(fixture, /successfulCalls/);
  assert.doesNotMatch(fixture, /from "\.\.\/\.\.\/\.\.\/packages\/providers\/src\/index\.js"/);
});

test("provider setup mounts the live loopback workflow and removes fixture connection claims", async () => {
  const workspace = await readFile("apps/studio/src/App.tsx", "utf8");
  const wizard = await readFile("apps/studio/src/components/providers/provider-connection-wizard.tsx", "utf8");
  const client = await readFile("apps/studio/src/provider-connection-client.ts", "utf8");
  assert.match(workspace, /ProviderConnectionWizard endpoint=\{controlPlaneEndpoint\}/);
  assert.match(wizard, /Official source/);
  assert.match(wizard, /structured-output evidence/);
  assert.match(wizard, /Current local evidence only/);
  assert.match(wizard, /Paid, promotional-credit, billing-enabled, stale, revoked, and unproven routes fail closed/);
  assert.match(client, /\/api\/v1\/provider-connections/);
  assert.doesNotMatch(workspace, /Demo evidence marks this connection ready/);
});

test("workspace exposes an interactive denial-of-wallet proof instead of a cost promise", async () => {
  const workspace = await readFile("apps/studio/src/App.tsx", "utf8");
  const fixture = await readFile("apps/studio/src/runtime-fixture.ts", "utf8");
  assert.match(workspace, /Denial of wallet/);
  assert.match(workspace, /Maximum automatic spend/);
  assert.match(workspace, /data-cost-details/);
  assert.match(
    workspace,
    /Paid mode requires a separate connection\s+approval/,
  );
  assert.match(fixture, /paidRoutesProduced: 0/);
  assert.match(fixture, /Billing-enabled projects denied/);
  assert.match(fixture, /lifecycle: "retired"/);
});

test("workspace has explicit responsive, focus, motion, and contrast contracts", async () => {
  const styles = await readFile("apps/studio/src/globals.css", "utf8");
  const source = await readFile("apps/studio/src/App.tsx", "utf8");
  assert.match(styles, /@media \(max-width: 76rem\)/);
  assert.match(styles, /@media \(max-width: 48rem\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /focus-visible:ring-3/);
  assert.match(styles, /@media \(forced-colors: active\)/);
});

test("settings contains only app connections and AI setup", async () => {
  const workspace = await readFile("apps/studio/src/App.tsx", "utf8");
  const fixture = await readFile("apps/studio/src/permission-fixture.ts", "utf8");
  const combined = `${workspace}\n${fixture}`;
  assert.match(combined, /Apps/);
  assert.match(workspace, /AI/);
  assert.match(workspace, /ConnectionCatalog/);
  assert.match(workspace, /ProviderConnectionWizard/);
  assert.doesNotMatch(workspace, /TabsTrigger value="permissions"/);
  assert.doesNotMatch(workspace, /TabsTrigger value="system"/);
  assert.doesNotMatch(workspace, /Mask for screen sharing/);
  assert.doesNotMatch(workspace, /Project permission posture/);
});
