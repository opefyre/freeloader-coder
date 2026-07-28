import { ArrowsClockwise } from "@phosphor-icons/react/ArrowsClockwise";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CloudArrowDown } from "@phosphor-icons/react/CloudArrowDown";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { Kanban } from "@phosphor-icons/react/Kanban";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { useState } from "react";

import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

const repositories = [
  {
    id: "freeloader",
    name: "freeloader-coder",
    owner: "opefyre",
    visibility: "Private",
    branch: "main",
    activity: "12m ago",
    selected: true
  },
  {
    id: "portfolio",
    name: "portfolio-lab",
    owner: "opefyre",
    visibility: "Private",
    branch: "main",
    activity: "2d ago",
    selected: false
  }
] as const;

const jiraIssues = [
  { key: "PIPE-72", title: "Granular GitHub authorization", points: 8, priority: "Highest" },
  { key: "PIPE-73", title: "Verified checkpoint publishing", points: 8, priority: "Highest" },
  { key: "PIPE-79", title: "Truthful evidence synchronization", points: 8, priority: "Highest" }
] as const;

const graphNodes = [
  { stage: "Ground", label: "Requirements + project evidence", state: "done" },
  { stage: "Build", label: "3 scoped implementation tasks", state: "done" },
  { stage: "Prove", label: "Checks + independent review", state: "ready" },
  { stage: "Sync", label: "Explicit external approval", state: "waiting" }
] as const;

export function IntegrationWorkbench() {
  const [githubConnected, setGithubConnected] = useState(true);
  const [jiraConnected, setJiraConnected] = useState(true);
  const [repository, setRepository] = useState("freeloader");
  const [selectedIssues, setSelectedIssues] = useState<string[]>(["PIPE-72", "PIPE-73"]);
  const [importState, setImportState] = useState<"idle" | "preview" | "ready">("idle");
  const [publishState, setPublishState] = useState<"idle" | "preview" | "verified">("idle");
  const [syncState, setSyncState] = useState<"idle" | "preview" | "verified">("idle");
  const [modelsEnabled, setModelsEnabled] = useState(false);

  function toggleIssue(key: string) {
    setSelectedIssues((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key]
    );
    setImportState("idle");
  }

  return (
    <section aria-labelledby="integration-title" className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="positive"><ShieldCheck weight="fill" /> Least privilege</Badge>
            <Badge>Interactive demo · no network writes</Badge>
            <a
              href="https://opefyre.atlassian.net/browse/PIPE-72"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-primary hover:underline"
            >
              PIPE-72–79
            </a>
          </div>
          <h2 id="integration-title" className="mt-4 text-2xl font-semibold">
            Connected work, without hidden writes
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Select exact repositories and Jira work, preview the local graph, then approve only the external changes you can see.
          </p>
        </div>
        <Badge tone="positive">0 broad tokens · 0 duplicate writes</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ConnectionCard
          icon={GithubLogo}
          name="GitHub"
          account="opefyre"
          connected={githubConnected}
          detail="2 selected repositories · Contents read · PR write"
          method="GitHub App installation · no classic PAT · grant revocation reconciled"
          source="https://github.com/settings/installations"
          ticket="https://opefyre.atlassian.net/browse/PIPE-72"
          onToggle={() => setGithubConnected((value) => !value)}
        />
        <ConnectionCard
          icon={Kanban}
          name="Jira"
          account="Opefyre Jira"
          connected={jiraConnected}
          detail="PIPE project · Board 133 · Work read · Comments write"
          method="OAuth 2.0 + PKCE · token in local vault · broker stores no project content"
          source="https://id.atlassian.com/manage-profile/apps"
          ticket="https://opefyre.atlassian.net/browse/PIPE-74"
          onToggle={() => setJiraConnected((value) => !value)}
        />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,.75fr)]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Repository entry</CardTitle>
              <CardDescription>
                Browse only authorized repositories. Existing folders and local checkpoints are never overwritten.
              </CardDescription>
            </div>
            <Badge tone={githubConnected ? "positive" : "caution"}>
              {githubConnected ? "GitHub verified" : "Reconnect required"}
            </Badge>
          </CardHeader>
          <CardContent className="mt-5 grid gap-3">
            {repositories.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={repository === item.id}
                onClick={() => {
                  setRepository(item.id);
                  setImportState("idle");
                }}
                className={cn(
                  "grid w-full gap-3 rounded-3xl bg-muted/45 p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 sm:grid-cols-[1fr_auto]",
                  repository === item.id && "bg-primary/[.09]"
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <GithubLogo className="text-primary" weight="fill" />
                    <strong className="truncate text-sm">{item.owner}/{item.name}</strong>
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {item.visibility} · {item.branch} · activity {item.activity}
                  </span>
                </span>
                <Badge tone={repository === item.id ? "active" : "neutral"}>
                  {repository === item.id ? "Selected" : "Available"}
                </Badge>
              </button>
            ))}
            <div className="rounded-3xl bg-emerald-400/[.07] p-4 text-xs leading-5">
              <strong className="block text-sm">Local destination is safe</strong>
              <span className="text-muted-foreground">
                /Projects/freeloader-coder is an existing matching project. Refresh creates a checkpoint first; conflicts open side by side.
              </span>
            </div>
            <Button
              disabled={!githubConnected}
              onClick={() => setImportState((state) => state === "idle" ? "preview" : "ready")}
            >
              <CloudArrowDown />
              {importState === "idle" ? "Preview repository refresh" : importState === "preview" ? "Create checkpoint and refresh" : "Repository ready"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>GitHub Models</CardTitle>
              <Badge tone={modelsEnabled ? "positive" : "neutral"}>
                {modelsEnabled ? "Enabled separately" : "Off"}
              </Badge>
            </div>
            <CardDescription>
              Model access is independent from repository access and remains inside free-only routing.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-5 space-y-3">
            <PermissionFact label="Repository effect" value="None" />
            <PermissionFact label="Requested scope" value="models:read only" />
            <PermissionFact label="Attribution" value="Personal account" />
            <PermissionFact label="Billing" value="Paid routes denied" />
            <button
              type="button"
              aria-pressed={modelsEnabled}
              onClick={() => setModelsEnabled((value) => !value)}
              className={cn(
                "flex w-full items-center justify-between rounded-3xl bg-muted/50 p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                modelsEnabled && "bg-emerald-400/[.08]"
              )}
            >
              <span>
                <strong className="block text-sm">Use eligible GitHub Models</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Quota and organization attribution are checked before each route.
                </span>
              </span>
              <span className={cn("grid size-7 place-items-center rounded-full bg-background", modelsEnabled && "bg-emerald-500 text-white")}>
                {modelsEnabled ? <Check weight="bold" /> : <LockKey />}
              </span>
            </button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Jira planning import</CardTitle>
            <CardDescription>
              Choose work visually. Stable IDs, source revision, hierarchy, estimates, dependencies, and acceptance criteria stay attached.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Opefyre Jira</Badge>
            <Badge>PIPE · Board 133</Badge>
          </div>
        </CardHeader>
        <CardContent className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-2">
            {jiraIssues.map((issue) => {
              const active = selectedIssues.includes(issue.key);
              return (
                <button
                  key={issue.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleIssue(issue.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-3xl bg-muted/45 p-4 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    active && "bg-primary/[.09]"
                  )}
                >
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-background", active && "bg-primary text-primary-foreground")}>
                    {active ? <Check weight="bold" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm">{issue.key}</strong>
                    <span className="block truncate text-xs text-muted-foreground">{issue.title}</span>
                  </span>
                  <Badge>{issue.priority} · {issue.points} pts</Badge>
                </button>
              );
            })}
            <Button
              className="w-full"
              disabled={!jiraConnected || selectedIssues.length === 0}
              onClick={() => setImportState("ready")}
            >
              <Sparkle weight="fill" />
              Build grounded task graph
            </Button>
          </div>
          <div className="rounded-[2rem] bg-muted/40 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <strong className="text-sm">Task graph preview</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedIssues.length} Jira issues · source revision 81c4…a92f
                </p>
              </div>
              <Badge tone={importState === "ready" ? "positive" : "neutral"}>
                {importState === "ready" ? "Grounded" : "Preview"}
              </Badge>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-4">
              {graphNodes.map((node, index) => (
                <div key={node.stage} className={cn("rounded-2xl bg-background/70 p-3", importState === "ready" && index < 3 && "bg-emerald-400/[.08]")}>
                  <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">{node.stage}</span>
                  <strong className="mt-2 block text-xs">{node.label}</strong>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedIssues.map((key) => (
                <a
                  key={key}
                  href={`https://opefyre.atlassian.net/browse/${key}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-background/70 px-3 py-2 text-xs font-semibold hover:text-primary"
                >
                  <LinkSimple /> {key}
                </a>
              ))}
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                <GitBranch /> Project grounding cited
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <EffectCard
          title="Publish verified checkpoint"
          description="One branch, one commit, and one pull request—generated from observed checks and protected by one idempotency key."
          icon={PaperPlaneTilt}
          state={publishState}
          previewLabel="Preview GitHub publish"
          approveLabel="Approve branch + commit + PR"
          doneLabel="Pull request verified"
          onAction={() => setPublishState((state) => state === "idle" ? "preview" : "verified")}
          facts={[
            ["Target", "opefyre/freeloader-coder · main"],
            ["Changed files", "Connected Work checkpoint"],
            ["Checks", "327 tests · build · responsive QA"],
            ["Undo", "Close PR and delete branch"]
          ]}
          result="Demo receipt: one branch, commit, and pull request passed postcondition validation. A live adapter must observe the real GitHub objects."
        />
        <EffectCard
          title="Synchronize Jira evidence"
          description="Preview exact status, comment, commit, PR, and validation links. Model output alone can never produce Done."
          icon={ArrowsClockwise}
          state={syncState}
          previewLabel="Preview Jira synchronization"
          approveLabel="Approve exact Jira changes"
          doneLabel="Jira update verified"
          onAction={() => setSyncState((state) => state === "idle" ? "preview" : "verified")}
          facts={[
            ["Issues", selectedIssues.join(", ") || "None selected"],
            ["Status", "In Review after deterministic checks"],
            ["Comment", "One evidence summary · no prompts"],
            ["Conflict rule", "Newer Jira revision stops sync"]
          ]}
          result="Demo receipt: one idempotency marker passed reconciliation. A live adapter must observe the real Jira revision."
        />
      </div>
    </section>
  );
}

function ConnectionCard({
  icon: Icon,
  name,
  account,
  connected,
  detail,
  method,
  source,
  ticket,
  onToggle
}: {
  icon: typeof GithubLogo;
  name: string;
  account: string;
  connected: boolean;
  detail: string;
  method: string;
  source: string;
  ticket: string;
  onToggle: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/[.10] text-primary">
          <Icon size={25} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{name}</strong>
            <Badge tone={connected ? "positive" : "caution"}>{connected ? "Connected" : "Revoked"}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{account} · {detail}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {method} · expiry checked before use
          </p>
          <div className="mt-3 flex gap-3 text-xs font-semibold">
            <a href={source} target="_blank" rel="noreferrer" className="hover:text-primary">Account access</a>
            <a href={ticket} target="_blank" rel="noreferrer" className="hover:text-primary">Work item</a>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onToggle}>
          {connected ? "Test revocation" : "Restore demo grant"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PermissionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-muted/45 p-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <strong className="max-w-[65%] text-right">{value}</strong>
    </div>
  );
}

function EffectCard({
  title,
  description,
  icon: Icon,
  state,
  previewLabel,
  approveLabel,
  doneLabel,
  onAction,
  facts,
  result
}: {
  title: string;
  description: string;
  icon: typeof PaperPlaneTilt;
  state: "idle" | "preview" | "verified";
  previewLabel: string;
  approveLabel: string;
  doneLabel: string;
  onAction: () => void;
  facts: readonly (readonly [string, string])[];
  result: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/[.10] text-primary">
          <Icon size={22} weight="duotone" />
        </span>
      </CardHeader>
      <CardContent className="mt-5 space-y-2">
        {facts.map(([label, value]) => <PermissionFact key={label} label={label} value={value} />)}
        {state !== "idle" && (
          <div className={cn("mt-4 rounded-3xl p-4 text-xs leading-5", state === "verified" ? "bg-emerald-400/[.08]" : "bg-amber-400/[.09]")} aria-live="polite">
            <strong className="block text-sm">{state === "verified" ? "Demo postcondition receipt" : "External effect preview"}</strong>
            <span className="text-muted-foreground">
              {state === "verified" ? result : "Nothing has been written yet. Review the target, effect, evidence, and undo above."}
            </span>
          </div>
        )}
        <Button className="mt-3 w-full" onClick={onAction} disabled={state === "verified"}>
          {state === "verified" ? <CheckCircle weight="fill" /> : state === "preview" ? <ShieldCheck /> : <Icon />}
          {state === "idle" ? previewLabel : state === "preview" ? approveLabel : doneLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
