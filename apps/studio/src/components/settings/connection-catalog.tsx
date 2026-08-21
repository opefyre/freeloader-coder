import { CalendarDots } from "@phosphor-icons/react/CalendarDots";
import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { Cloud } from "@phosphor-icons/react/Cloud";
import { EnvelopeSimple } from "@phosphor-icons/react/EnvelopeSimple";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { Kanban } from "@phosphor-icons/react/Kanban";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { Robot } from "@phosphor-icons/react/Robot";
import { X } from "@phosphor-icons/react/X";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { Button } from "../ui/button.js";
import { beginIntegrationOAuth, connectTelegramConnection, connectTokenService, disconnectJiraConnection, disconnectServiceConnection, disconnectTelegramConnection, listIntegrationConnections } from "../../integration-connection-client.js";
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
  { id: "github", name: "GitHub", group: "Work", icon: GithubLogo, available: true },
  { id: "jira", name: "Jira", group: "Work", icon: Kanban, available: true },
  { id: "telegram", name: "Telegram", group: "Messages", icon: PaperPlaneTilt, available: true },
  { id: "discord", name: "Discord", group: "Messages", icon: ChatCircleDots, available: true },
  { id: "slack", name: "Slack", group: "Messages", icon: PlugsConnected, available: true },
  { id: "gmail", name: "Gmail", group: "Messages", icon: EnvelopeSimple, available: true },
  { id: "calendar", name: "Google Calendar", group: "Messages", icon: CalendarDots, available: true },
  { id: "cloudflare", name: "Cloudflare", group: "Cloud", icon: Cloud, available: true },
  { id: "gcloud", name: "Google Cloud", group: "Cloud", icon: Cloud, available: true },
  { id: "aws", name: "AWS", group: "Cloud", icon: Cloud, available: true },
  { id: "vercel", name: "Vercel", group: "Cloud", icon: Cloud, available: true },
];

export function ConnectionCatalog(props: { openProviders: () => void; endpoint?: string }) {
  const [group, setGroup] = useState<"All" | Connection["group"]>("All");
  const [notice, setNotice] = useState("");
  const [observed, setObserved] = useState<PublicIntegrationConnectionCollection | null>(null);
  const [working, setWorking] = useState(false);
  const [jiraSetupOpen, setJiraSetupOpen] = useState(false);
  const [deviceCode, setDeviceCode] = useState("");
  const [telegramSetupOpen, setTelegramSetupOpen] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChat, setTelegramChat] = useState("");
  const [telegramOwner, setTelegramOwner] = useState("");
  const [serviceOpen, setServiceOpen] = useState<"google" | "slack" | "discord" | "cloudflare" | "aws" | "vercel" | null>(null);
  const [tokenOpen, setTokenOpen] = useState<"cloudflare" | "aws" | "vercel" | null>(null);
  const [tokenSecret, setTokenSecret] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const endpoint = props.endpoint ?? "http://127.0.0.1:4312";
  useEffect(() => { void listIntegrationConnections({ endpoint }).then(setObserved).catch(() => setObserved(null)); }, [endpoint]);
  const visible = connections.filter((connection) => group === "All" || connection.group === group);
  const startOAuth = (provider: "github" | "jira" | "google" | "slack" | "discord") => {
    setWorking(true); setNotice(""); setDeviceCode("");
    void beginIntegrationOAuth({ endpoint, provider, idempotencyKey: `oauth-start:${provider}:${crypto.randomUUID()}` }).then((result) => {
      if (result.userCode) setDeviceCode(result.userCode);
      window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
      setNotice(result.userCode ? `Enter ${result.userCode} in the GitHub tab. This page will update automatically.` : `Approve ${provider[0]?.toUpperCase()}${provider.slice(1)} in the browser.`);
      window.setTimeout(() => void listIntegrationConnections({ endpoint }).then(setObserved), 4_000);
    }).catch((error) => setNotice(error instanceof Error ? error.message : "Browser authorization could not start.")).finally(() => setWorking(false));
  };

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
          const providerId = connection.id === "gmail" || connection.id === "calendar" || connection.id === "gcloud" ? "google" : connection.id;
          const live = observed?.connections.find((item) => item.provider === providerId);
          const ready = live?.state === "ready";
          return (
            <div key={connection.id} className="flex items-center gap-3 rounded-3xl bg-muted/50 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-background text-primary"><Icon size={20} weight="duotone" /></span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{connection.name}</strong>{ready && <span className="block truncate text-xs text-muted-foreground">{live?.accountLabel}</span>}</span>
              <Button size="sm" variant={connection.available || ready ? "secondary" : "ghost"} disabled={working} onClick={() => {
                if (connection.id === "ai") props.openProviders();
                else if (connection.id === "github") {
                  if (ready) setNotice("GitHub is connected. Choose repositories inside a project."); else startOAuth("github");
                } else if (connection.id === "jira") {
                  if (ready) setJiraSetupOpen(true); else startOAuth("jira");
                } else if (connection.id === "telegram") {
                  setTelegramSetupOpen(true);
                } else if (providerId === "google" || providerId === "slack" || providerId === "discord") {
                  if (ready) setServiceOpen(providerId); else startOAuth(providerId);
                } else if (providerId === "cloudflare" || providerId === "aws" || providerId === "vercel") {
                  if (ready) setServiceOpen(providerId); else setTokenOpen(providerId);
                }
              }}>
                {connection.id === "ai" ? "Set up" : ready ? "Manage" : "Connect"}
              </Button>
            </div>
          );
        })}
      </div>
      <SettingsDialog open={jiraSetupOpen} onOpenChange={setJiraSetupOpen} title="Jira">
        <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{observed?.connections.find((item) => item.provider === "jira")?.resources.length ?? 0} projects available</span><Button size="sm" variant="secondary" disabled={working} onClick={() => { setWorking(true); void disconnectJiraConnection({ endpoint, idempotencyKey: `jira-disconnect:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setJiraSetupOpen(false); setNotice("Jira disconnected."); }).catch((error) => setNotice(error instanceof Error ? error.message : "Jira disconnect failed.")).finally(() => setWorking(false)); }}>Disconnect</Button></div>
      </SettingsDialog>
      {deviceCode && <div className="mx-auto max-w-xl rounded-3xl bg-primary/10 p-5 text-center"><span className="text-xs text-muted-foreground">GitHub code</span><strong className="mt-2 block font-mono text-2xl tracking-[.2em]">{deviceCode}</strong></div>}
      <SettingsDialog open={telegramSetupOpen} onOpenChange={setTelegramSetupOpen} title="Telegram">
        {observed?.connections.find((item) => item.provider === "telegram")?.state === "ready" ? <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{observed.connections.find((item) => item.provider === "telegram")?.resources[0]?.label ?? "Notification chat ready"}</span><Button size="sm" variant="secondary" disabled={working} onClick={() => { setWorking(true); void disconnectTelegramConnection({ endpoint, idempotencyKey: `telegram-disconnect:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setTelegramSetupOpen(false); setNotice("Telegram disconnected."); }).catch((error) => setNotice(error instanceof Error ? error.message : "Telegram disconnect failed.")).finally(() => setWorking(false)); }}>Disconnect</Button></div> : <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); setWorking(true); void connectTelegramConnection({ endpoint, botToken: telegramToken, chatId: telegramChat, ownerUserId: telegramOwner, idempotencyKey: `telegram-connect:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setTelegramToken(""); setTelegramSetupOpen(false); setNotice(result.connections.find((item) => item.provider === "telegram")?.nextAction ?? "Telegram connected."); }).catch((error) => setNotice(error instanceof Error ? error.message : "Telegram connection failed.")).finally(() => setWorking(false)); }}>
          <input aria-label="Telegram bot token" type="password" required autoComplete="off" placeholder="Bot token" value={telegramToken} onChange={(event) => setTelegramToken(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <input aria-label="Telegram chat" required placeholder="Chat ID or @channel" value={telegramChat} onChange={(event) => setTelegramChat(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <input aria-label="Telegram owner user ID" inputMode="numeric" required pattern="[0-9]{5,20}" placeholder="Your Telegram user ID" value={telegramOwner} onChange={(event) => setTelegramOwner(event.target.value.replace(/\D/g, ""))} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <p className="text-xs text-muted-foreground">Only this Telegram account can approve project decisions.</p>
          <Button type="submit" disabled={working || telegramToken.length < 30 || telegramChat.length < 5 || telegramOwner.length < 5}>Connect</Button>
        </form>}
      </SettingsDialog>
      <SettingsDialog open={serviceOpen !== null} onOpenChange={(open) => { if (!open) setServiceOpen(null); }} title={serviceOpen ? `${serviceOpen[0]?.toUpperCase()}${serviceOpen.slice(1)}` : "Connection"}>
        {serviceOpen &&
        <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{observed?.connections.find((item) => item.provider === serviceOpen)?.resources.length ?? 0} options available</span><Button size="sm" variant="secondary" disabled={working} onClick={() => { setWorking(true); void disconnectServiceConnection({ endpoint, provider: serviceOpen, idempotencyKey: `service-disconnect:${serviceOpen}:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setServiceOpen(null); setNotice(`${serviceOpen} disconnected.`); }).catch((error) => setNotice(error instanceof Error ? error.message : "Disconnect failed.")).finally(() => setWorking(false)); }}>Disconnect</Button></div>
        }
      </SettingsDialog>
      <SettingsDialog open={tokenOpen !== null} onOpenChange={(open) => { if (!open) setTokenOpen(null); }} title={tokenOpen ? `${tokenOpen[0]?.toUpperCase()}${tokenOpen.slice(1)}` : "Connection"}>
        {tokenOpen &&
        <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); const provider = tokenOpen; setWorking(true); void connectTokenService({ endpoint, provider, ...(provider === "aws" ? { accessKeyId } : {}), secret: tokenSecret, idempotencyKey: `token-connect:${provider}:${crypto.randomUUID()}` }).then((result) => { setObserved(result); setTokenSecret(""); setAccessKeyId(""); setTokenOpen(null); setNotice(`${provider} connected.`); }).catch((error) => setNotice(error instanceof Error ? error.message : "Connection failed.")).finally(() => setWorking(false)); }}>
          {tokenOpen === "aws" && <input aria-label="AWS access key ID" required autoComplete="off" placeholder="Access key ID" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />}
          <input aria-label={`${tokenOpen} secret`} type="password" required autoComplete="off" placeholder={tokenOpen === "aws" ? "Secret access key" : "API token"} value={tokenSecret} onChange={(event) => setTokenSecret(event.target.value)} className="rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
          <Button type="submit" disabled={working || tokenSecret.length < 8 || (tokenOpen === "aws" && accessKeyId.length < 8)}>Connect</Button>
        </form>}
      </SettingsDialog>
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{notice}</p>
    </section>
  );
}

function SettingsDialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-background/75 backdrop-blur-md transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" /><Dialog.Popup className="fixed inset-x-3 bottom-3 z-50 max-h-[88vh] overflow-y-auto rounded-[1.75rem] bg-card p-5 shadow-2xl outline-none transition duration-200 data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-6"><header className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-xl font-semibold tracking-tight">{title}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">Manage this connection.</Dialog.Description></div><Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-full bg-muted outline-none transition hover:bg-foreground hover:text-background" aria-label="Close"><X /></Dialog.Close></header>{children}</Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
import { Dialog } from "@base-ui/react/dialog";
