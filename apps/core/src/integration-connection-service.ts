import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  jiraConnectionInputSchema,
  telegramConnectionInputSchema,
  publicIntegrationConnectionCollectionSchema,
  type PublicIntegrationConnectionCollection,
} from "../../../packages/runtime/src/integration-connections.js";
import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";

const execFileAsync = promisify(execFile);

type Runner = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;
type Fetcher = typeof fetch;

const JIRA_CREDENTIAL_REFERENCE = "vault:providers/jira/default";
export const TELEGRAM_CREDENTIAL_REFERENCE = "vault:providers/telegram/default";

export class IntegrationConnectionService {
  readonly #runner: Runner;
  readonly #vault: Pick<CredentialVault, "write" | "read" | "delete"> | null;
  readonly #fetcher: Fetcher;
  #github: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #jira: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #telegram: PublicIntegrationConnectionCollection["connections"][number] | null = null;

  constructor(
    runner: Runner = safeExec,
    vault: Pick<CredentialVault, "write" | "read" | "delete"> | null = null,
    fetcher: Fetcher = fetch
  ) {
    this.#runner = runner;
    this.#vault = vault;
    this.#fetcher = fetcher;
  }

  async list(): Promise<PublicIntegrationConnectionCollection> {
    if (!this.#jira && this.#vault && await this.#vault.read(JIRA_CREDENTIAL_REFERENCE)) {
      this.#jira = await this.#probeStoredJira();
    }
    if (!this.#telegram && this.#vault && await this.#vault.read(TELEGRAM_CREDENTIAL_REFERENCE)) {
      this.#telegram = await this.#probeStoredTelegram();
    }
    return this.#collection();
  }

  async probeGitHub(): Promise<PublicIntegrationConnectionCollection> {
    const observedAt = Date.now();
    try {
      const [userResult, repositoryResult] = await Promise.all([
        this.#runner("gh", ["api", "user", "--jq", ".login"]),
        this.#runner("gh", ["repo", "list", "--limit", "100", "--json", "id,nameWithOwner,url,isPrivate,defaultBranchRef"]),
      ]);
      const accountLabel = userResult.stdout.trim();
      const raw = JSON.parse(repositoryResult.stdout) as unknown;
      if (!accountLabel || !Array.isArray(raw)) throw new Error("GitHub returned invalid account data.");
      const resources = raw.map((candidate) => parseRepository(candidate));
      this.#github = { schemaVersion: 1, provider: "github", state: "ready", accountLabel, authMethod: "github_cli_oauth", observedAt, resources, nextAction: resources.length > 0 ? "Choose repositories inside a project." : "Grant GitHub CLI access to at least one repository." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const unavailable = /ENOENT|not found|spawn gh/i.test(message);
      this.#github = this.#emptyGitHub(unavailable ? "Install GitHub CLI, then sign in once." : "Sign in with GitHub CLI, then choose Detect again.", unavailable ? "unavailable" : "not_connected");
    }
    return this.#collection();
  }

  async connectJira(input: unknown): Promise<PublicIntegrationConnectionCollection> {
    if (!this.#vault) throw new Error("Secure credential storage is unavailable.");
    const parsed = jiraConnectionInputSchema.parse(input);
    const secret = JSON.stringify({ siteUrl: normalizeSiteUrl(parsed.siteUrl), email: parsed.email, apiToken: parsed.apiToken });
    await this.#vault.write(JIRA_CREDENTIAL_REFERENCE, secret);
    try {
      this.#jira = await this.#probeStoredJira();
      if (this.#jira.state !== "ready") throw new Error("Jira authentication failed.");
    } catch (error) {
      await this.#vault.delete(JIRA_CREDENTIAL_REFERENCE);
      this.#jira = this.#emptyJira("Check the Jira site, email, and API token, then connect again.", "not_connected");
      throw error;
    }
    return this.#collection();
  }

  async disconnectJira(): Promise<PublicIntegrationConnectionCollection> {
    await this.#vault?.delete(JIRA_CREDENTIAL_REFERENCE);
    this.#jira = this.#emptyJira("Connect Jira to choose a project.");
    return this.#collection();
  }

  async connectTelegram(input: unknown): Promise<PublicIntegrationConnectionCollection> {
    if (!this.#vault) throw new Error("Secure credential storage is unavailable.");
    const parsed = telegramConnectionInputSchema.parse(input);
    await this.#vault.write(TELEGRAM_CREDENTIAL_REFERENCE, JSON.stringify(parsed));
    try {
      this.#telegram = await this.#probeStoredTelegram();
      if (this.#telegram.state !== "ready") throw new Error("Telegram authentication failed.");
    } catch (error) {
      await this.#vault.delete(TELEGRAM_CREDENTIAL_REFERENCE);
      this.#telegram = this.#emptyTelegram("Check the bot token, add the bot to the chat, and connect again.", "not_connected");
      throw error;
    }
    return this.#collection();
  }

  async disconnectTelegram(): Promise<PublicIntegrationConnectionCollection> {
    await this.#vault?.delete(TELEGRAM_CREDENTIAL_REFERENCE);
    this.#telegram = this.#emptyTelegram("Connect a Telegram bot to choose its chat inside a project.");
    return this.#collection();
  }

  async #probeStoredJira() {
    const stored = await this.#vault?.read(JIRA_CREDENTIAL_REFERENCE);
    if (!stored) return this.#emptyJira("Connect Jira to choose a project.");
    const credential = parseStoredJira(stored);
    const authorization = `Basic ${Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64")}`;
    const headers = { Accept: "application/json", Authorization: authorization };
    const [myselfResponse, projectsResponse] = await Promise.all([
      this.#fetcher(`${credential.siteUrl}/rest/api/3/myself`, { headers, redirect: "error" }),
      this.#fetcher(`${credential.siteUrl}/rest/api/3/project/search?maxResults=100&orderBy=name`, { headers, redirect: "error" }),
    ]);
    if (!myselfResponse.ok || !projectsResponse.ok) throw new Error("Jira authentication failed.");
    const myself = await boundedJson(myselfResponse);
    const projects = await boundedJson(projectsResponse);
    if (typeof myself.displayName !== "string" || !Array.isArray(projects.values)) throw new Error("Jira returned invalid account data.");
    const observedAt = Date.now();
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({
      schemaVersion: 1,
      provider: "jira",
      state: "ready",
      accountLabel: myself.displayName,
      authMethod: "jira_api_token",
      observedAt,
      resources: projects.values.map((value) => parseJiraProject(value, credential.siteUrl)),
      nextAction: projects.values.length > 0 ? "Choose a Jira project inside a project." : "Grant this account access to at least one Jira project.",
    });
  }

  async #probeStoredTelegram() {
    const stored = await this.#vault?.read(TELEGRAM_CREDENTIAL_REFERENCE);
    if (!stored) return this.#emptyTelegram("Connect a Telegram bot to choose its chat inside a project.");
    const credential = telegramConnectionInputSchema.parse(JSON.parse(stored));
    const base = `https://api.telegram.org/bot${credential.botToken}`;
    const [identityResponse, chatResponse] = await Promise.all([
      this.#fetcher(`${base}/getMe`, { redirect: "error" }),
      this.#fetcher(`${base}/getChat?chat_id=${encodeURIComponent(credential.chatId)}`, { redirect: "error" }),
    ]);
    if (!identityResponse.ok || !chatResponse.ok) throw new Error("Telegram authentication failed.");
    const identity = await boundedJson(identityResponse);
    const chat = await boundedJson(chatResponse);
    const bot = identity.result && typeof identity.result === "object" ? identity.result as Record<string, unknown> : null;
    const target = chat.result && typeof chat.result === "object" ? chat.result as Record<string, unknown> : null;
    if (!bot || !target || typeof bot.username !== "string" || (typeof target.id !== "number" && typeof target.id !== "string")) throw new Error("Telegram returned invalid account data.");
    const title = typeof target.title === "string" ? target.title : typeof target.username === "string" ? `@${target.username}` : typeof target.first_name === "string" ? target.first_name : "Telegram chat";
    const targetUrl = typeof target.username === "string" ? `https://t.me/${target.username}` : "https://t.me";
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({
      schemaVersion: 1, provider: "telegram", state: "ready", accountLabel: `@${bot.username}`, authMethod: "telegram_bot_token", observedAt: Date.now(),
      resources: [{ id: String(target.id), kind: "telegram_chat", label: title, url: targetUrl, detail: "Bot-authorized notification chat" }],
      nextAction: "Choose this chat inside a project.",
    });
  }

  #collection() {
    const observedAt = Date.now();
    return publicIntegrationConnectionCollectionSchema.parse({
      schemaVersion: 1,
      provenance: "local_observation",
      observedAt,
      connections: [
        this.#github ?? this.#emptyGitHub("Choose Detect to use the GitHub login already stored by GitHub CLI."),
        this.#jira ?? this.#emptyJira("Connect Jira to choose a project."),
        this.#telegram ?? this.#emptyTelegram("Connect a Telegram bot to choose its chat inside a project."),
      ],
    });
  }

  #emptyGitHub(nextAction: string, state: "not_connected" | "unavailable" = "not_connected") {
    return { schemaVersion: 1 as const, provider: "github" as const, state, accountLabel: null, authMethod: "github_cli_oauth" as const, observedAt: Date.now(), resources: [], nextAction };
  }

  #emptyJira(nextAction: string, state: "not_connected" | "unavailable" = "not_connected") {
    return { schemaVersion: 1 as const, provider: "jira" as const, state, accountLabel: null, authMethod: "jira_api_token" as const, observedAt: Date.now(), resources: [], nextAction };
  }
  #emptyTelegram(nextAction: string, state: "not_connected" | "unavailable" = "not_connected") {
    return { schemaVersion: 1 as const, provider: "telegram" as const, state, accountLabel: null, authMethod: "telegram_bot_token" as const, observedAt: Date.now(), resources: [], nextAction };
  }
}

async function safeExec(file: string, args: readonly string[]): Promise<{ stdout: string }> {
  const result = await execFileAsync(file, [...args], { timeout: 20_000, maxBuffer: 1_000_000, windowsHide: true });
  return { stdout: result.stdout };
}

function parseRepository(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("GitHub repository data is invalid.");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.nameWithOwner !== "string" || typeof item.url !== "string") throw new Error("GitHub repository data is incomplete.");
  const branch = item.defaultBranchRef && typeof item.defaultBranchRef === "object" && typeof (item.defaultBranchRef as Record<string, unknown>).name === "string" ? String((item.defaultBranchRef as Record<string, unknown>).name) : "No default branch";
  return { id: item.id, kind: "github_repository" as const, label: item.nameWithOwner, url: item.url, detail: `${item.isPrivate === true ? "Private" : "Public"} · ${branch}` };
}

function normalizeSiteUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".atlassian.net") || url.port || url.username || url.password || url.search || url.hash) throw new Error("Jira site URL is invalid.");
  return url.origin;
}

function parseStoredJira(value: string): { siteUrl: string; email: string; apiToken: string } {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (typeof parsed.siteUrl !== "string" || typeof parsed.email !== "string" || typeof parsed.apiToken !== "string") throw new Error("Stored Jira credential is invalid.");
  return { siteUrl: normalizeSiteUrl(parsed.siteUrl), email: parsed.email, apiToken: parsed.apiToken };
}

function parseJiraProject(value: unknown, siteUrl: string) {
  if (!value || typeof value !== "object") throw new Error("Jira project data is invalid.");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.key !== "string" || typeof item.name !== "string") throw new Error("Jira project data is incomplete.");
  return { id: item.id, kind: "jira_project" as const, label: `${item.key} · ${item.name}`, url: `${siteUrl}/jira/software/projects/${encodeURIComponent(item.key)}`, detail: item.projectTypeKey === "software" ? "Software project" : "Jira project" };
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > 1_000_000) throw new Error("Jira response is too large.");
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Jira response is too large.");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Jira returned invalid data.");
  return parsed as Record<string, unknown>;
}
