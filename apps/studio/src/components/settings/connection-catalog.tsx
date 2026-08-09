import { CalendarDots } from "@phosphor-icons/react/CalendarDots";
import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { Cloud } from "@phosphor-icons/react/Cloud";
import { EnvelopeSimple } from "@phosphor-icons/react/EnvelopeSimple";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { Kanban } from "@phosphor-icons/react/Kanban";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { Robot } from "@phosphor-icons/react/Robot";
import { useEffect, useState } from "react";

import { Button } from "../ui/button.js";
import { connectJiraConnection, connectTelegramConnection, disconnectJiraConnection, disconnectTelegramConnection, listIntegrationConnections, probeGitHubConnection } from "../../integration-connection-client.js";
import type { PublicIntegrationConnectionCollection } from "../../../../../packages/runtime/src/integration-connections.js";

type Connection = {
  id: string;
  name: string;
  group: "Work" | "Messages" | "Cloud";
  icon: typeof GithubLogo;
  available: boolean;
};

const connections: readonly Connection[] = [
  { id: "ai", name: "AI providers", group: "Work", icon: Robot, available: true },
  { id: "github", name: "GitHub", group: "Work", icon: GithubLogo, available: false },
  { id: "jira", name: "Jira", group: "Work", icon: Kanban, available: false },
  { id: "telegram", name: "Telegram", group: "Messages", icon: PaperPlaneTilt, available: true },
  { id: "discord", name: "Discord", group: "Messages", icon: ChatCircleDots, available: false },
  { id: "slack", name: "Slack", group: "Messages", icon: PlugsConnected, available: false },
  { id: "gmail", name: "Gmail", group: "Messages", icon: EnvelopeSimple, available: false },
  { id: "calendar", name: "Google Calendar", group: "Messages", icon: CalendarDots, available: false },
  { id: "cloudflare", name: "Cloudflare", group: "Cloud", icon: Cloud, available: false },
  { id: "gcloud", name: "Google Cloud", group: "Cloud", icon: Cloud, available: false },
  { id: "aws", name: "AWS", group: "Cloud", icon: Cloud, available: false },
  { id: "vercel", name: "Vercel", group: "Cloud", icon: Cloud, available: false },
];

export function ConnectionCatalog(props: { openProviders: () => void; endpoint?: string }) {
  const [group, setGroup] = useState<"All" | Connection["group"]>("All");
  const [notice, setNotice] = useState("");
  const [observed, setObserved] = useState<PublicIntegrationConnectionCollection | null>(null);
  const [working, setWorking] = useState(false);
  const [jiraSetupOpen, setJiraSetupOpen] = useState(false);
  const [jiraSite, setJiraSite] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [telegramSetupOpen, setTelegramSetupOpen] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChat, setTelegramChat] = useState("");
  const endpoint = props.endpoint ?? "http://127.0.0.1:4312";
  useEffect(() => { void listIntegrationConnections({ endpoint }).then(setObserved).catch(() => setObserved(null)); }, [endpoint]);
  const visible = connections.filter((connection) => group === "All" || connection.group === group);

  return (
    <section aria-labelledby="connections-title" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="connections-title" className="text-xl font-semibold">Connections</h2>
        <div className="flex gap-1 rounded-2xl bg-muted p-1" role="group" aria-label="Connection category">
          {(["All", "Work", "Messages", "Cloud"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={group === item} onClick={() => setGroup(item)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${group === item ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((connection) => {
          const Icon = connection.icon;
          const live = observed?.connections.find((item) => item.provider === connection.id);
          const ready = live?.state === "ready";
          return (
            <div key={connection.id} className="flex items-center gap-3 rounded-3xl bg-muted/50 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-background text-primary"><Icon size={20} weight="duotone" /></span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{connection.name}</strong>{ready && <span className="block truncate text-xs text-muted-foreground">{live?.accountLabel}</span>}</span>
              <Button size="sm" variant={connection.available || ready ? "secondary" : "ghost"} disabled={working && (connection.id === "github" || connection.id === "jira")} onClick={() => {
                if (connection.id === "ai") props.openProviders();
                else if (connection.id === "github") {
                  setWorking(true);
                  void probeGitHubConnection({ endpoint, idempotencyKey: `github-probe:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setNotice(result.connections[0]?.nextAction ?? "GitHub checked."); }).catch((error) => setNotice(error instanceof Error ? error.message : "GitHub check failed.")).finally(() => setWorking(false));
                } else if (connection.id === "jira") {
                  setJiraSetupOpen(true);
                } else if (connection.id === "telegram") {
                  setTelegramSetupOpen(true);
                } else setNotice(`${connection.name} connection is not installed yet.`);
              }}>
                {connection.id === "github" ? (ready ? "Refresh" : "Detect") : connection.id === "jira" || connection.id === "telegram" ? (ready ? "Manage" : "Connect") : connection.available ? "Set up" : "Not connected"}
              </Button>
            </div>
          );
        })}
      </div>
      {jiraSetupOpen && <div role="dialog" aria-modal="false" aria-labelledby="jira-connect-title" className="mx-auto max-w-xl rounded-3xl bg-muted/55 p-5">
        <div className="flex items-center justify-between gap-3"><h3 id="jira-connect-title" className="font-semibold">Jira</h3><Button size="sm" variant="ghost" onClick={() => setJiraSetupOpen(false)}>Close</Button></div>
        {observed?.connections.find((item) => item.provider === "jira")?.state === "ready" ? <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{observed.connections.find((item) => item.provider === "jira")?.resources.length ?? 0} projects available</span><Button size="sm" variant="secondary" disabled={working} onClick={() => { setWorking(true); void disconnectJiraConnection({ endpoint, idempotencyKey: `jira-disconnect:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setJiraSetupOpen(false); setNotice("Jira disconnected."); }).catch((error) => setNotice(error instanceof Error ? error.message : "Jira disconnect failed.")).finally(() => setWorking(false)); }}>Disconnect</Button></div> : <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); setWorking(true); void connectJiraConnection({ endpoint, siteUrl: jiraSite, email: jiraEmail, apiToken: jiraToken, idempotencyKey: `jira-connect:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setJiraToken(""); setJiraSetupOpen(false); setNotice(result.connections.find((item) => item.provider === "jira")?.nextAction ?? "Jira connected."); }).catch((error) => setNotice(error instanceof Error ? error.message : "Jira connection failed.")).finally(() => setWorking(false)); }}>
          <input aria-label="Jira site" type="url" required placeholder="https://company.atlassian.net" value={jiraSite} onChange={(event) => setJiraSite(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <input aria-label="Jira account email" type="email" required placeholder="you@company.com" value={jiraEmail} onChange={(event) => setJiraEmail(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <input aria-label="Jira API token" type="password" required autoComplete="off" placeholder="API token" value={jiraToken} onChange={(event) => setJiraToken(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <Button type="submit" disabled={working || !jiraSite || !jiraEmail || jiraToken.length < 8}>Connect</Button>
        </form>}
      </div>}
      {telegramSetupOpen && <div role="dialog" aria-modal="false" aria-labelledby="telegram-connect-title" className="mx-auto max-w-xl rounded-3xl bg-muted/55 p-5">
        <div className="flex items-center justify-between gap-3"><h3 id="telegram-connect-title" className="font-semibold">Telegram</h3><Button size="sm" variant="ghost" onClick={() => setTelegramSetupOpen(false)}>Close</Button></div>
        {observed?.connections.find((item) => item.provider === "telegram")?.state === "ready" ? <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{observed.connections.find((item) => item.provider === "telegram")?.resources[0]?.label ?? "Notification chat ready"}</span><Button size="sm" variant="secondary" disabled={working} onClick={() => { setWorking(true); void disconnectTelegramConnection({ endpoint, idempotencyKey: `telegram-disconnect:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setTelegramSetupOpen(false); setNotice("Telegram disconnected."); }).catch((error) => setNotice(error instanceof Error ? error.message : "Telegram disconnect failed.")).finally(() => setWorking(false)); }}>Disconnect</Button></div> : <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); setWorking(true); void connectTelegramConnection({ endpoint, botToken: telegramToken, chatId: telegramChat, idempotencyKey: `telegram-connect:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setTelegramToken(""); setTelegramSetupOpen(false); setNotice(result.connections.find((item) => item.provider === "telegram")?.nextAction ?? "Telegram connected."); }).catch((error) => setNotice(error instanceof Error ? error.message : "Telegram connection failed.")).finally(() => setWorking(false)); }}>
          <input aria-label="Telegram bot token" type="password" required autoComplete="off" placeholder="Bot token" value={telegramToken} onChange={(event) => setTelegramToken(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <input aria-label="Telegram chat" required placeholder="Chat ID or @channel" value={telegramChat} onChange={(event) => setTelegramChat(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <Button type="submit" disabled={working || telegramToken.length < 30 || telegramChat.length < 5}>Connect</Button>
        </form>}
      </div>}
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{notice}</p>
    </section>
  );
}
