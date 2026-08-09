import { CalendarDots } from "@phosphor-icons/react/CalendarDots";
import { ChatCircleDots } from "@phosphor-icons/react/ChatCircleDots";
import { Cloud } from "@phosphor-icons/react/Cloud";
import { EnvelopeSimple } from "@phosphor-icons/react/EnvelopeSimple";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { Kanban } from "@phosphor-icons/react/Kanban";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { Robot } from "@phosphor-icons/react/Robot";
import { useState } from "react";

import { Button } from "../ui/button.js";

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
  { id: "telegram", name: "Telegram", group: "Messages", icon: PaperPlaneTilt, available: false },
  { id: "discord", name: "Discord", group: "Messages", icon: ChatCircleDots, available: false },
  { id: "slack", name: "Slack", group: "Messages", icon: PlugsConnected, available: false },
  { id: "gmail", name: "Gmail", group: "Messages", icon: EnvelopeSimple, available: false },
  { id: "calendar", name: "Google Calendar", group: "Messages", icon: CalendarDots, available: false },
  { id: "cloudflare", name: "Cloudflare", group: "Cloud", icon: Cloud, available: false },
  { id: "gcloud", name: "Google Cloud", group: "Cloud", icon: Cloud, available: false },
  { id: "aws", name: "AWS", group: "Cloud", icon: Cloud, available: false },
  { id: "vercel", name: "Vercel", group: "Cloud", icon: Cloud, available: false },
];

export function ConnectionCatalog(props: { openProviders: () => void }) {
  const [group, setGroup] = useState<"All" | Connection["group"]>("All");
  const [notice, setNotice] = useState("");
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
          return (
            <div key={connection.id} className="flex items-center gap-3 rounded-3xl bg-muted/50 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-background text-primary"><Icon size={20} weight="duotone" /></span>
              <strong className="min-w-0 flex-1 truncate text-sm">{connection.name}</strong>
              <Button size="sm" variant={connection.available ? "secondary" : "ghost"} onClick={() => {
                if (connection.id === "ai") props.openProviders();
                else setNotice(`${connection.name} connection is not installed yet.`);
              }}>
                {connection.available ? "Set up" : "Not connected"}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{notice}</p>
    </section>
  );
}
