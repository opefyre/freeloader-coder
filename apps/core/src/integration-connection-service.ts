import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  jiraConnectionInputSchema,
  oauthAppConfigurationInputSchema,
  telegramConnectionInputSchema,
  tokenConnectionInputSchema,
  publicIntegrationConnectionCollectionSchema,
  type PublicIntegrationConnectionCollection,
  type OAuthAuthorizationStart,
} from "../../../packages/runtime/src/integration-connections.js";
import type { CredentialVault } from "../../../packages/providers/src/lifecycle.js";

type Fetcher = typeof fetch;
type Runner = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const JIRA_CREDENTIAL_REFERENCE = "vault:providers/jira/default";
const JIRA_REFRESH_REFERENCE = "vault:providers/jira/refresh";
const GOOGLE_CREDENTIAL_REFERENCE = "vault:providers/google/default";
const SLACK_CREDENTIAL_REFERENCE = "vault:providers/slack/default";
const DISCORD_CREDENTIAL_REFERENCE = "vault:providers/discord/default";
const CLOUDFLARE_CREDENTIAL_REFERENCE = "vault:providers/cloudflare/default";
const AWS_CREDENTIAL_REFERENCE = "vault:providers/aws/default";
const VERCEL_CREDENTIAL_REFERENCE = "vault:providers/vercel/default";
const GITHUB_CREDENTIAL_REFERENCE = "vault:providers/github/default";
const GITHUB_OAUTH_APP_REFERENCE = "vault:oauth-apps/github";
const JIRA_OAUTH_APP_REFERENCE = "vault:oauth-apps/jira";
export const TELEGRAM_CREDENTIAL_REFERENCE = "vault:providers/telegram/default";

export class IntegrationConnectionService {
  readonly #vault: Pick<CredentialVault, "write" | "read" | "delete"> | null;
  readonly #fetcher: Fetcher;
  #github: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #jira: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #telegram: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #google: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #slack: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #discord: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #cloudflare: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #aws: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #vercel: PublicIntegrationConnectionCollection["connections"][number] | null = null;
  #githubDevice: { deviceCode: string; interval: number; expiresAt: number } | null = null;
  #jiraSession: { state: string; redirectUri: string; expiresAt: number } | null = null;

  constructor(
    _runner: Runner = async () => ({ stdout: "" }),
    vault: Pick<CredentialVault, "write" | "read" | "delete"> | null = null,
    fetcher: Fetcher = fetch
  ) {
    this.#vault = vault;
    this.#fetcher = fetcher;
  }

  async list(): Promise<PublicIntegrationConnectionCollection> {
    if (!this.#github && this.#vault && await this.#vault.read(GITHUB_CREDENTIAL_REFERENCE)) {
      try {
        this.#github = await this.#probeStoredGitHub();
      } catch {
        this.#github = this.#emptyGitHub("Reconnect GitHub in your browser.", "unavailable");
      }
    }
    if (!this.#jira && this.#vault && await this.#vault.read(JIRA_CREDENTIAL_REFERENCE)) {
      try {
        this.#jira = await this.#probeStoredJiraOAuth();
      } catch {
        this.#jira = this.#emptyJira("Reconnect Jira in your browser.", "unavailable");
      }
    }
    if (!this.#telegram && this.#vault && await this.#vault.read(TELEGRAM_CREDENTIAL_REFERENCE)) {
      try {
        this.#telegram = await this.#probeStoredTelegram();
      } catch {
        this.#telegram = this.#emptyTelegram("Reconnect Telegram.", "unavailable");
      }
    }
    for (const [reference, assign, probe, empty] of [
      [GOOGLE_CREDENTIAL_REFERENCE, (value: any) => { this.#google = value; }, () => this.#probeStoredGoogle(), () => this.#emptyService("google", "google_oauth", "Reconnect Google in your browser.", "unavailable")],
      [SLACK_CREDENTIAL_REFERENCE, (value: any) => { this.#slack = value; }, () => this.#probeStoredSlack(), () => this.#emptyService("slack", "slack_oauth", "Reconnect Slack in your browser.", "unavailable")],
      [DISCORD_CREDENTIAL_REFERENCE, (value: any) => { this.#discord = value; }, () => this.#probeStoredDiscord(), () => this.#emptyService("discord", "discord_oauth", "Reconnect Discord in your browser.", "unavailable")],
      [CLOUDFLARE_CREDENTIAL_REFERENCE, (value: any) => { this.#cloudflare = value; }, () => this.#probeStoredCloudflare(), () => this.#emptyService("cloudflare", "cloudflare_api_token", "Reconnect Cloudflare.", "unavailable")],
      [VERCEL_CREDENTIAL_REFERENCE, (value: any) => { this.#vercel = value; }, () => this.#probeStoredVercel(), () => this.#emptyService("vercel", "vercel_oauth_or_token", "Reconnect Vercel.", "unavailable")],
    ] as const) {
      const current = reference === GOOGLE_CREDENTIAL_REFERENCE ? this.#google : reference === SLACK_CREDENTIAL_REFERENCE ? this.#slack : reference === DISCORD_CREDENTIAL_REFERENCE ? this.#discord : reference === CLOUDFLARE_CREDENTIAL_REFERENCE ? this.#cloudflare : this.#vercel;
      if (!current && this.#vault && await this.#vault.read(reference)) {
        try { assign(await probe()); } catch { assign(empty()); }
      }
    }
    if (!this.#aws && this.#vault && await this.#vault.read(AWS_CREDENTIAL_REFERENCE)) {
      try { this.#aws = await this.#probeStoredAws(); } catch { this.#aws = this.#emptyService("aws", "aws_access_key", "Reconnect AWS with a scoped access key.", "unavailable"); }
    }
    return this.#collection();
  }

  async probeGitHub(): Promise<PublicIntegrationConnectionCollection> {
    this.#github = this.#emptyGitHub("Connect with GitHub in your browser. Command-line sign-in is not used.", "setup_required");
    return this.#collection();
  }

  async configureOAuth(input: unknown): Promise<PublicIntegrationConnectionCollection> {
    if (!this.#vault) throw new Error("Secure credential storage is unavailable.");
    const parsed = oauthAppConfigurationInputSchema.parse(input);
    if (parsed.provider === "jira" && !parsed.clientSecret) throw new Error("Jira requires an OAuth app secret.");
    await this.#vault.write(parsed.provider === "github" ? GITHUB_OAUTH_APP_REFERENCE : JIRA_OAUTH_APP_REFERENCE, JSON.stringify({ clientId: parsed.clientId, ...(parsed.clientSecret ? { clientSecret: parsed.clientSecret } : {}) }));
    return this.#collection();
  }

  async beginOAuth(provider: "github" | "jira", redirectUri: string): Promise<OAuthAuthorizationStart> {
    if (!this.#vault) throw new Error("Secure credential storage is unavailable.");
    const stored = await this.#vault.read(provider === "github" ? GITHUB_OAUTH_APP_REFERENCE : JIRA_OAUTH_APP_REFERENCE);
    if (!stored) throw new Error(`${provider === "github" ? "GitHub" : "Jira"} OAuth app setup is required once before connecting.`);
    const config = JSON.parse(stored) as { clientId: string; clientSecret?: string };
    if (provider === "github") {
      const response = await this.#fetcher("https://github.com/login/device/code", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, scope: "repo read:user user:email" }) });
      const body = await boundedJson(response);
      if (!response.ok || typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof body.verification_uri !== "string") throw new Error("GitHub did not start browser authorization.");
      const expiresAt = Date.now() + Number(body.expires_in ?? 900) * 1000;
      this.#githubDevice = { deviceCode: body.device_code, interval: Math.max(5, Number(body.interval ?? 5)), expiresAt };
      this.#github = { ...this.#emptyGitHub("Finish authorization in the browser.", "authorizing"), observedAt: Date.now() };
      void this.#pollGitHub(config.clientId);
      return { schemaVersion: 1, provider, mode: "device", authorizationUrl: body.verification_uri, userCode: body.user_code, expiresAt };
    }
    if (!config.clientSecret) throw new Error("Jira OAuth app setup is incomplete.");
    const state = randomBytes(32).toString("base64url");
    this.#jiraSession = { state: createHash("sha256").update(state).digest("hex"), redirectUri, expiresAt: Date.now() + 600_000 };
    const url = new URL("https://auth.atlassian.com/authorize");
    url.search = new URLSearchParams({ audience: "api.atlassian.com", client_id: config.clientId, scope: "read:jira-work write:jira-work offline_access", redirect_uri: redirectUri, state, response_type: "code", prompt: "consent" }).toString();
    this.#jira = { ...this.#emptyJira("Finish authorization in the browser.", "authorizing"), observedAt: Date.now() };
    return { schemaVersion: 1, provider, mode: "redirect", authorizationUrl: url.toString(), userCode: null, expiresAt: this.#jiraSession.expiresAt };
  }

  async completeJiraOAuth(input: { code: string; state: string }): Promise<void> {
    if (!this.#vault || !this.#jiraSession || this.#jiraSession.expiresAt < Date.now()) throw new Error("Jira authorization expired. Start again.");
    if (createHash("sha256").update(input.state).digest("hex") !== this.#jiraSession.state) throw new Error("Jira authorization state is invalid.");
    const stored = await this.#vault.read(JIRA_OAUTH_APP_REFERENCE);
    if (!stored) throw new Error("Jira OAuth app setup is missing.");
    const config = JSON.parse(stored) as { clientId: string; clientSecret: string };
    const response = await this.#fetcher("https://auth.atlassian.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret, code: input.code, redirect_uri: this.#jiraSession.redirectUri }) });
    const token = await boundedJson(response);
    if (!response.ok || typeof token.access_token !== "string") throw new Error("Jira authorization could not be completed.");
    await this.#vault.write(JIRA_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token ?? null, expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000 }));
    this.#jiraSession = null;
    this.#jira = await this.#probeStoredJiraOAuth();
  }

  async completeBrokerOAuth(provider: "github" | "jira" | "google" | "slack" | "discord" | "vercel", ticket: string): Promise<void> {
    if (!this.#vault) throw new Error("Secure credential storage is unavailable.");
    const response = await this.#fetcher("https://pipeline-studio-oauth.opefyre.workers.dev/v1/oauth/exchange", { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ticket }) });
    const result = await boundedJson(response);
    const credential = result.credential && typeof result.credential === "object" ? result.credential as Record<string, unknown> : null;
    if (!response.ok || !credential || typeof credential.access_token !== "string") {
      console.error("oauth_broker_exchange_failed", { provider, status: response.status, error: typeof result.error === "string" ? result.error : "invalid_response" });
      throw new Error("Browser authorization could not be completed.");
    }
    if (provider === "github") {
      if (await this.#vault.read(GITHUB_CREDENTIAL_REFERENCE)) await this.#vault.delete(GITHUB_CREDENTIAL_REFERENCE);
      await this.#vault.write(GITHUB_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: credential.access_token }));
      this.#github = await this.#probeStoredGitHub();
      return;
    }
    if (provider === "google") {
      if (await this.#vault.read(GOOGLE_CREDENTIAL_REFERENCE)) await this.#vault.delete(GOOGLE_CREDENTIAL_REFERENCE);
      await this.#vault.write(GOOGLE_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: credential.access_token, refreshGrant: typeof credential.refresh_grant === "string" ? credential.refresh_grant : null, refreshToken: typeof credential.refresh_token === "string" ? credential.refresh_token : null, expiresAt: Date.now() + Number(credential.expires_in ?? 3600) * 1000 }));
      this.#google = await this.#probeStoredGoogle();
      return;
    }
    if (provider === "vercel") {
      if (await this.#vault.read(VERCEL_CREDENTIAL_REFERENCE)) await this.#vault.delete(VERCEL_CREDENTIAL_REFERENCE);
      await this.#vault.write(VERCEL_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: credential.access_token }));
      this.#vercel = await this.#probeStoredVercel();
      return;
    }
    if (provider === "slack") {
      if (await this.#vault.read(SLACK_CREDENTIAL_REFERENCE)) await this.#vault.delete(SLACK_CREDENTIAL_REFERENCE);
      await this.#vault.write(SLACK_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: credential.access_token }));
      this.#slack = await this.#probeStoredSlack();
      return;
    }
    if (provider === "discord") {
      if (await this.#vault.read(DISCORD_CREDENTIAL_REFERENCE)) await this.#vault.delete(DISCORD_CREDENTIAL_REFERENCE);
      await this.#vault.write(DISCORD_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: credential.access_token }));
      this.#discord = await this.#probeStoredDiscord();
      return;
    }
    try {
      if (await this.#vault.read(JIRA_CREDENTIAL_REFERENCE)) await this.#vault.delete(JIRA_CREDENTIAL_REFERENCE);
      await this.#vault.write(JIRA_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: credential.access_token, expiresAt: Date.now() + Number(credential.expires_in ?? 3600) * 1000 }));
      if (typeof credential.refresh_grant === "string") {
        if (await this.#vault.read(JIRA_REFRESH_REFERENCE)) await this.#vault.delete(JIRA_REFRESH_REFERENCE);
        await this.#vault.write(JIRA_REFRESH_REFERENCE, JSON.stringify({ brokerRefreshGrant: credential.refresh_grant }));
      } else if (typeof credential.refresh_token === "string") {
        if (await this.#vault.read(JIRA_REFRESH_REFERENCE)) await this.#vault.delete(JIRA_REFRESH_REFERENCE);
        await this.#vault.write(JIRA_REFRESH_REFERENCE, JSON.stringify({ refreshToken: credential.refresh_token }));
      }
    } catch (error) {
      console.error("jira_credential_save_failed", { name: error instanceof Error ? error.name : "unknown", code: error && typeof error === "object" && "code" in error ? String(error.code) : "unknown", message: error instanceof Error ? error.message : "unknown" });
      throw error;
    }
    try {
      this.#jira = await this.#probeStoredJiraOAuth();
    } catch (error) {
      await this.#vault.delete(JIRA_CREDENTIAL_REFERENCE);
      this.#jira = this.#emptyJira("Jira authorization did not grant all required access. Connect again.", "unavailable");
      throw error;
    }
  }

  async connectJira(input: unknown): Promise<PublicIntegrationConnectionCollection> {
    void input;
    throw new Error("API-token sign-in is disabled. Use Connect with Jira in the browser.");
  }

  async disconnectJira(): Promise<PublicIntegrationConnectionCollection> {
    await this.#vault?.delete(JIRA_CREDENTIAL_REFERENCE);
    await this.#vault?.delete(JIRA_REFRESH_REFERENCE);
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

  async connectToken(input: unknown): Promise<PublicIntegrationConnectionCollection> {
    if (!this.#vault) throw new Error("Secure credential storage is unavailable.");
    const parsed = tokenConnectionInputSchema.parse(input);
    const reference = parsed.provider === "cloudflare" ? CLOUDFLARE_CREDENTIAL_REFERENCE : parsed.provider === "aws" ? AWS_CREDENTIAL_REFERENCE : VERCEL_CREDENTIAL_REFERENCE;
    if (await this.#vault.read(reference)) await this.#vault.delete(reference);
    await this.#vault.write(reference, JSON.stringify(parsed));
    try {
      if (parsed.provider === "cloudflare") this.#cloudflare = await this.#probeStoredCloudflare();
      else if (parsed.provider === "vercel") this.#vercel = await this.#probeStoredVercel();
      else this.#aws = await this.#probeStoredAws();
    } catch (error) { await this.#vault.delete(reference); throw error; }
    return this.#collection();
  }

  async disconnectService(provider: "google" | "slack" | "discord" | "cloudflare" | "aws" | "vercel"): Promise<PublicIntegrationConnectionCollection> {
    const reference = provider === "google" ? GOOGLE_CREDENTIAL_REFERENCE : provider === "slack" ? SLACK_CREDENTIAL_REFERENCE : provider === "discord" ? DISCORD_CREDENTIAL_REFERENCE : provider === "cloudflare" ? CLOUDFLARE_CREDENTIAL_REFERENCE : provider === "aws" ? AWS_CREDENTIAL_REFERENCE : VERCEL_CREDENTIAL_REFERENCE;
    await this.#vault?.delete(reference);
    if (provider === "google") this.#google = null; else if (provider === "slack") this.#slack = null; else if (provider === "discord") this.#discord = null; else if (provider === "cloudflare") this.#cloudflare = null; else if (provider === "aws") this.#aws = null; else this.#vercel = null;
    return this.#collection();
  }

  async #probeStoredJiraOAuth() {
    const stored = await this.#vault?.read(JIRA_CREDENTIAL_REFERENCE);
    if (!stored) return this.#emptyJira("Connect Jira to choose a project.");
    let credential = JSON.parse(stored) as { accessToken?: string; refreshToken?: string | null; expiresAt?: number };
    if (typeof credential.accessToken !== "string") return this.#emptyJira("Reconnect Jira in the browser.");
    if (typeof credential.expiresAt === "number" && credential.expiresAt <= Date.now() + 60_000) {
      const storedRefresh = await this.#vault?.read(JIRA_REFRESH_REFERENCE);
      const refresh = storedRefresh ? JSON.parse(storedRefresh) as { brokerRefreshGrant?: string; refreshToken?: string } : null;
      const refreshRequest = refresh?.brokerRefreshGrant ? { provider: "jira", refreshGrant: refresh.brokerRefreshGrant } : refresh?.refreshToken ? { provider: "jira", refreshToken: refresh.refreshToken } : null;
      if (!refreshRequest) throw new Error("Jira authorization expired.");
      const response = await this.#fetcher("https://pipeline-studio-oauth.opefyre.workers.dev/v1/oauth/refresh", { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(refreshRequest) });
      const result = await boundedJson(response); const next = result.credential && typeof result.credential === "object" ? result.credential as Record<string, unknown> : null;
      if (!response.ok || !next || typeof next.access_token !== "string" || typeof next.refresh_grant !== "string") throw new Error("Jira authorization could not be refreshed.");
      credential = { accessToken: next.access_token, refreshToken: null, expiresAt: Date.now() + Number(next.expires_in ?? 3600) * 1000 };
      await this.#vault?.write(JIRA_CREDENTIAL_REFERENCE, JSON.stringify(credential));
      await this.#vault?.write(JIRA_REFRESH_REFERENCE, JSON.stringify({ brokerRefreshGrant: next.refresh_grant }));
    }
    const headers = { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` };
    const resourcesResponse = await this.#fetcher("https://api.atlassian.com/oauth/token/accessible-resources", { headers, redirect: "error" });
    const sites = await boundedJsonArray(resourcesResponse);
    const site = sites[0] as Record<string, unknown> | undefined;
    if (!resourcesResponse.ok || !site || typeof site.id !== "string" || typeof site.url !== "string") {
      console.error("jira_connection_probe_failed", { step: "accessible_resources", status: resourcesResponse.status, resourceCount: sites.length });
      throw new Error("Jira authorization has no accessible site.");
    }
    const [myselfResponse, projectsResponse] = await Promise.all([
      this.#fetcher(`https://api.atlassian.com/ex/jira/${encodeURIComponent(site.id)}/rest/api/3/myself`, { headers, redirect: "error" }),
      this.#fetcher(`https://api.atlassian.com/ex/jira/${encodeURIComponent(site.id)}/rest/api/3/project/search?maxResults=100&orderBy=name`, { headers, redirect: "error" }),
    ]);
    if (!projectsResponse.ok) {
      console.error("jira_connection_probe_failed", { step: "projects", status: projectsResponse.status, profileStatus: myselfResponse.status });
      throw new Error("Jira authentication could not read projects.");
    }
    const myself = myselfResponse.ok ? await boundedJson(myselfResponse) : {};
    const projects = await boundedJson(projectsResponse);
    if (!Array.isArray(projects.values)) throw new Error("Jira returned invalid project data.");
    const accountLabel = myselfResponse.ok && typeof myself.displayName === "string"
      ? myself.displayName
      : typeof site.name === "string"
        ? site.name
        : new URL(site.url).hostname;
    const observedAt = Date.now();
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({
      schemaVersion: 1,
      provider: "jira",
      state: "ready",
      accountLabel,
      authMethod: "jira_oauth_3lo",
      observedAt,
      resources: projects.values.map((value) => parseJiraProject(value, site.url as string)),
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

  async #probeStoredGoogle() {
    const stored = await this.#vault?.read(GOOGLE_CREDENTIAL_REFERENCE); if (!stored) return this.#emptyService("google", "google_oauth", "Connect Google in your browser.");
    let credential = JSON.parse(stored) as { accessToken?: string; refreshGrant?: string | null; refreshToken?: string | null; expiresAt?: number }; if (!credential.accessToken) return this.#emptyService("google", "google_oauth", "Reconnect Google.", "unavailable");
    if (typeof credential.expiresAt === "number" && credential.expiresAt <= Date.now() + 60_000) {
      if (!credential.refreshGrant && !credential.refreshToken) throw new Error("Google authorization expired.");
      const refreshResponse = await this.#fetcher("https://pipeline-studio-oauth.opefyre.workers.dev/v1/oauth/refresh", { method: "POST", headers: { Origin: "http://127.0.0.1:4310", "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(credential.refreshGrant ? { provider: "google", refreshGrant: credential.refreshGrant } : { provider: "google", refreshToken: credential.refreshToken }) });
      const refreshed = await boundedJson(refreshResponse); const next = refreshed.credential && typeof refreshed.credential === "object" ? refreshed.credential as Record<string, unknown> : null;
      if (!refreshResponse.ok || !next || typeof next.access_token !== "string") throw new Error("Google authorization expired.");
      credential = { accessToken: next.access_token, refreshGrant: typeof next.refresh_grant === "string" ? next.refresh_grant : credential.refreshGrant ?? null, refreshToken: null, expiresAt: Date.now() + Number(next.expires_in ?? 3600) * 1000 };
      await this.#vault?.delete(GOOGLE_CREDENTIAL_REFERENCE); await this.#vault?.write(GOOGLE_CREDENTIAL_REFERENCE, JSON.stringify(credential));
    }
    const headers = { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` };
    const [userResponse, calendarsResponse, projectsResponse] = await Promise.all([
      this.#fetcher("https://openidconnect.googleapis.com/v1/userinfo", { headers, redirect: "error" }),
      this.#fetcher("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100", { headers, redirect: "error" }),
      this.#fetcher("https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=100", { headers, redirect: "error" }),
    ]);
    if (!userResponse.ok) throw new Error("Google authentication failed.");
    const user = await boundedJson(userResponse); const calendars = calendarsResponse.ok ? await boundedJson(calendarsResponse) : {}; const projects = projectsResponse.ok ? await boundedJson(projectsResponse) : {};
    const resources = [
      { id: String(user.sub ?? user.email ?? "google"), kind: "google_account" as const, label: String(user.email ?? user.name ?? "Google account"), url: "https://myaccount.google.com/", detail: "Gmail account" },
      ...(Array.isArray(calendars.items) ? calendars.items : []).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")).map((item) => ({ id: String(item.id), kind: "google_calendar" as const, label: String(item.summary ?? item.id), url: "https://calendar.google.com/", detail: item.primary === true ? "Primary calendar" : "Google calendar" })),
      ...(Array.isArray(projects.projects) ? projects.projects : []).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).projectId === "string")).map((item) => ({ id: String(item.projectId), kind: "gcloud_project" as const, label: String(item.name ?? item.projectId), url: `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(String(item.projectId))}`, detail: "Google Cloud project" })),
    ];
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({ schemaVersion: 1, provider: "google", state: "ready", accountLabel: String(user.email ?? user.name ?? "Google"), authMethod: "google_oauth", observedAt: Date.now(), resources, nextAction: Array.isArray(calendars.items) ? "Choose Google services inside a project." : "Gmail is connected; Calendar access is unavailable." });
  }

  async #probeStoredSlack() {
    const stored = await this.#vault?.read(SLACK_CREDENTIAL_REFERENCE); if (!stored) return this.#emptyService("slack", "slack_oauth", "Connect Slack in your browser.");
    const credential = JSON.parse(stored) as { accessToken?: string }; if (!credential.accessToken) throw new Error("Slack credential is incomplete.");
    const headers = { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` };
    const [identityResponse, channelsResponse] = await Promise.all([
      this.#fetcher("https://slack.com/api/auth.test", { headers, redirect: "error" }),
      this.#fetcher("https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200", { headers, redirect: "error" }),
    ]);
    const identity = await boundedJson(identityResponse); const channels = await boundedJson(channelsResponse);
    if (!identityResponse.ok || identity.ok !== true || typeof identity.team_id !== "string") throw new Error("Slack authentication failed.");
    const teamId = identity.team_id; const teamName = String(identity.team ?? "Slack workspace");
    const resources = [
      { id: teamId, kind: "slack_workspace" as const, label: teamName, url: typeof identity.url === "string" ? identity.url : "https://app.slack.com/", detail: "Slack workspace" },
      ...(channelsResponse.ok && channels.ok === true && Array.isArray(channels.channels) ? channels.channels : []).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")).map((item) => ({ id: String(item.id), kind: "slack_channel" as const, label: `#${String(item.name ?? item.id)}`, url: `https://app.slack.com/client/${encodeURIComponent(teamId)}/${encodeURIComponent(String(item.id))}`, detail: item.is_private === true ? "Private channel" : "Public channel" })),
    ];
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({ schemaVersion: 1, provider: "slack", state: "ready", accountLabel: teamName, authMethod: "slack_oauth", observedAt: Date.now(), resources, nextAction: "Choose Slack channels inside a project." });
  }

  async #probeStoredDiscord() {
    const stored = await this.#vault?.read(DISCORD_CREDENTIAL_REFERENCE); if (!stored) return this.#emptyService("discord", "discord_oauth", "Connect Discord in your browser.");
    const credential = JSON.parse(stored) as { accessToken?: string }; if (!credential.accessToken) throw new Error("Discord credential is incomplete.");
    const headers = { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` };
    const [userResponse, guildsResponse] = await Promise.all([
      this.#fetcher("https://discord.com/api/v10/users/@me", { headers, redirect: "error" }),
      this.#fetcher("https://discord.com/api/v10/users/@me/guilds", { headers, redirect: "error" }),
    ]);
    const user = await boundedJson(userResponse); const guilds = await boundedJsonArray(guildsResponse);
    if (!userResponse.ok || !guildsResponse.ok || typeof user.id !== "string") throw new Error("Discord authentication failed.");
    const resources = guilds.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")).map((item) => ({ id: String(item.id), kind: "discord_server" as const, label: String(item.name ?? item.id), url: `https://discord.com/channels/${encodeURIComponent(String(item.id))}`, detail: item.owner === true ? "Owned server" : "Discord server" }));
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({ schemaVersion: 1, provider: "discord", state: "ready", accountLabel: String(user.global_name ?? user.username ?? "Discord"), authMethod: "discord_oauth", observedAt: Date.now(), resources, nextAction: "Choose Discord servers inside a project." });
  }

  async #probeStoredCloudflare() {
    const stored = await this.#vault?.read(CLOUDFLARE_CREDENTIAL_REFERENCE); if (!stored) return this.#emptyService("cloudflare", "cloudflare_api_token", "Connect Cloudflare with an API token.");
    const credential = tokenConnectionInputSchema.parse(JSON.parse(stored)); const headers = { Accept: "application/json", Authorization: `Bearer ${credential.secret}` };
    const response = await this.#fetcher("https://api.cloudflare.com/client/v4/accounts?per_page=50", { headers, redirect: "error" }); const body = await boundedJson(response);
    if (!response.ok || body.success !== true || !Array.isArray(body.result)) throw new Error("Cloudflare token could not read accounts.");
    const resources = body.result.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")).map((item) => ({ id: String(item.id), kind: "cloudflare_account" as const, label: String(item.name ?? "Cloudflare account"), url: `https://dash.cloudflare.com/${encodeURIComponent(String(item.id))}`, detail: "Cloudflare account" }));
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({ schemaVersion: 1, provider: "cloudflare", state: "ready", accountLabel: resources[0]?.label ?? "Cloudflare", authMethod: "cloudflare_api_token", observedAt: Date.now(), resources, nextAction: "Choose a Cloudflare account inside a project." });
  }

  async #probeStoredVercel() {
    const stored = await this.#vault?.read(VERCEL_CREDENTIAL_REFERENCE); if (!stored) return this.#emptyService("vercel", "vercel_oauth_or_token", "Connect Vercel.");
    const parsed = JSON.parse(stored) as { accessToken?: string; secret?: string }; const token = parsed.accessToken ?? parsed.secret; if (!token) throw new Error("Vercel credential is incomplete.");
    const headers = { Accept: "application/json", Authorization: `Bearer ${token}` }; const [userResponse, teamsResponse] = await Promise.all([this.#fetcher("https://api.vercel.com/v2/user", { headers }), this.#fetcher("https://api.vercel.com/v2/teams?limit=100", { headers })]);
    const user = await boundedJson(userResponse); const teams = teamsResponse.ok ? await boundedJson(teamsResponse) : {};
    if (!userResponse.ok || !user.user || typeof user.user !== "object") throw new Error("Vercel authentication failed."); const profile = user.user as Record<string, unknown>;
    const resources = (Array.isArray(teams.teams) ? teams.teams : []).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")).map((item) => ({ id: String(item.id), kind: "vercel_team" as const, label: String(item.name ?? item.slug ?? "Vercel team"), url: `https://vercel.com/${encodeURIComponent(String(item.slug ?? item.id))}`, detail: "Vercel team" }));
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({ schemaVersion: 1, provider: "vercel", state: "ready", accountLabel: String(profile.username ?? profile.email ?? "Vercel"), authMethod: "vercel_oauth_or_token", observedAt: Date.now(), resources, nextAction: "Choose a Vercel team inside a project." });
  }

  async #probeStoredAws() {
    const stored = await this.#vault?.read(AWS_CREDENTIAL_REFERENCE); if (!stored) return this.#emptyService("aws", "aws_access_key", "Connect AWS with a scoped access key.");
    const credential = tokenConnectionInputSchema.parse(JSON.parse(stored));
    if (!credential.accessKeyId) throw new Error("AWS access key ID is required.");
    const now = new Date(); const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); const dateStamp = amzDate.slice(0, 8);
    const host = "sts.amazonaws.com"; const region = "us-east-1"; const service = "sts"; const query = "Action=GetCallerIdentity&Version=2011-06-15";
    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`; const signedHeaders = "host;x-amz-date"; const payloadHash = createHash("sha256").update("").digest("hex");
    const canonicalRequest = `GET\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`; const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
    const kDate = createHmac("sha256", `AWS4${credential.secret}`).update(dateStamp).digest(); const kRegion = createHmac("sha256", kDate).update(region).digest(); const kService = createHmac("sha256", kRegion).update(service).digest(); const kSigning = createHmac("sha256", kService).update("aws4_request").digest(); const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await this.#fetcher(`https://${host}/?${query}`, { headers: { Accept: "application/xml", Authorization: authorization, "X-Amz-Date": amzDate }, redirect: "error" }); const xml = await response.text();
    if (!response.ok) throw new Error("AWS credentials could not verify the account."); const account = xml.match(/<Account>([^<]+)<\/Account>/)?.[1]; const arn = xml.match(/<Arn>([^<]+)<\/Arn>/)?.[1]; if (!account || !arn) throw new Error("AWS returned invalid account data.");
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({ schemaVersion: 1, provider: "aws", state: "ready", accountLabel: account, authMethod: "aws_access_key", observedAt: Date.now(), resources: [{ id: account, kind: "aws_account", label: `AWS ${account}`, url: "https://console.aws.amazon.com/", detail: arn }], nextAction: "Choose this AWS account inside a project." });
  }

  async #pollGitHub(clientId: string) {
    const attempt = this.#githubDevice;
    if (!attempt || !this.#vault) return;
    while (this.#githubDevice === attempt && Date.now() < attempt.expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, attempt.interval * 1000));
      const response = await this.#fetcher("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, device_code: attempt.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) });
      const body = await boundedJson(response);
      if (body.error === "authorization_pending") continue;
      if (body.error === "slow_down") { attempt.interval += 5; continue; }
      if (!response.ok || typeof body.access_token !== "string") {
        this.#github = this.#emptyGitHub("GitHub authorization ended. Try Connect again.");
        this.#githubDevice = null;
        return;
      }
      await this.#vault.write(GITHUB_CREDENTIAL_REFERENCE, JSON.stringify({ accessToken: body.access_token }));
      this.#githubDevice = null;
      this.#github = await this.#probeStoredGitHub();
      return;
    }
    this.#github = this.#emptyGitHub("GitHub authorization expired. Try Connect again.");
    this.#githubDevice = null;
  }

  async #probeStoredGitHub() {
    const stored = await this.#vault?.read(GITHUB_CREDENTIAL_REFERENCE);
    if (!stored) return this.#emptyGitHub("Connect with GitHub in your browser.");
    const credential = JSON.parse(stored) as { accessToken?: string };
    if (typeof credential.accessToken !== "string") return this.#emptyGitHub("Reconnect GitHub in your browser.");
    const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${credential.accessToken}`, "X-GitHub-Api-Version": "2022-11-28" };
    const [userResponse, repositoryResponse] = await Promise.all([
      this.#fetcher("https://api.github.com/user", { headers, redirect: "error" }),
      this.#fetcher("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", { headers, redirect: "error" }),
    ]);
    const user = await boundedJson(userResponse); const repositories = await boundedJsonArray(repositoryResponse);
    if (!userResponse.ok || !repositoryResponse.ok || typeof user.login !== "string") throw new Error("GitHub authorization could not read repositories.");
    const resources = repositories.map(parseOAuthRepository);
    return publicIntegrationConnectionCollectionSchema.shape.connections.element.parse({ schemaVersion: 1, provider: "github", state: "ready", accountLabel: user.login, authMethod: "github_device_oauth", observedAt: Date.now(), resources, nextAction: resources.length ? "Choose repositories inside a project." : "No repositories are available to this authorization." });
  }

  #collection() {
    const observedAt = Date.now();
    return publicIntegrationConnectionCollectionSchema.parse({
      schemaVersion: 1,
      provenance: "local_observation",
      observedAt,
      connections: [
        this.#github ?? this.#emptyGitHub("Connect with GitHub in your browser."),
        this.#jira ?? this.#emptyJira("Connect Jira to choose a project."),
        this.#telegram ?? this.#emptyTelegram("Connect a Telegram bot to choose its chat inside a project."),
        this.#google ?? this.#emptyService("google", "google_oauth", "Connect Google for Gmail, Calendar, and Cloud projects."),
        this.#slack ?? this.#emptyService("slack", "slack_oauth", "Connect Slack in your browser."),
        this.#discord ?? this.#emptyService("discord", "discord_oauth", "Connect Discord in your browser."),
        this.#cloudflare ?? this.#emptyService("cloudflare", "cloudflare_api_token", "Connect Cloudflare with an API token."),
        this.#aws ?? this.#emptyService("aws", "aws_access_key", "Connect AWS with a scoped access key."),
        this.#vercel ?? this.#emptyService("vercel", "vercel_oauth_or_token", "Connect Vercel in your browser or with a token."),
      ],
    });
  }

  #emptyGitHub(nextAction: string, state: "not_connected" | "authorizing" | "setup_required" | "unavailable" = "not_connected") {
    return { schemaVersion: 1 as const, provider: "github" as const, state, accountLabel: null, authMethod: "github_device_oauth" as const, observedAt: Date.now(), resources: [], nextAction };
  }

  #emptyJira(nextAction: string, state: "not_connected" | "authorizing" | "setup_required" | "unavailable" = "not_connected") {
    return { schemaVersion: 1 as const, provider: "jira" as const, state, accountLabel: null, authMethod: "jira_oauth_3lo" as const, observedAt: Date.now(), resources: [], nextAction };
  }
  #emptyTelegram(nextAction: string, state: "not_connected" | "unavailable" = "not_connected") {
    return { schemaVersion: 1 as const, provider: "telegram" as const, state, accountLabel: null, authMethod: "telegram_bot_token" as const, observedAt: Date.now(), resources: [], nextAction };
  }
  #emptyService(provider: "google" | "slack" | "discord" | "cloudflare" | "aws" | "vercel", authMethod: "google_oauth" | "slack_oauth" | "discord_oauth" | "cloudflare_api_token" | "aws_access_key" | "vercel_oauth_or_token", nextAction: string, state: "not_connected" | "authorizing" | "setup_required" | "unavailable" | "failed" = "not_connected") {
    return { schemaVersion: 1 as const, provider, state, accountLabel: null, authMethod, observedAt: Date.now(), resources: [], nextAction } as PublicIntegrationConnectionCollection["connections"][number];
  }
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

async function boundedJsonArray(response: Response): Promise<unknown[]> {
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Provider response is too large.");
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Provider returned invalid data.");
  return parsed;
}

function parseOAuthRepository(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("GitHub repository data is invalid.");
  const item = value as Record<string, unknown>;
  if ((typeof item.id !== "number" && typeof item.id !== "string") || typeof item.full_name !== "string" || typeof item.html_url !== "string") throw new Error("GitHub repository data is incomplete.");
  return { id: String(item.id), kind: "github_repository" as const, label: item.full_name, url: item.html_url, detail: `${item.private === true ? "Private" : "Public"} · ${typeof item.default_branch === "string" ? item.default_branch : "No default branch"}` };
}
