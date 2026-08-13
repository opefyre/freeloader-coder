import type {
  InfrastructureAdapter,
  InfrastructureMutationPreview,
} from "../../../packages/orchestration/src/infrastructure-delivery.js";

export const CLOUDFLARE_INFRASTRUCTURE_CREDENTIAL_REFERENCE =
  "vault:providers/cloudflare/default";

type CredentialReader = {
  read(reference: string): Promise<string | null>;
};

type Fetcher = typeof fetch;

type CloudflareEnvelope = {
  success?: boolean;
  result?: unknown;
};

type Deployment = {
  id?: unknown;
  url?: unknown;
  latest_stage?: { status?: unknown } | null;
};

export class CloudflarePagesInfrastructureAdapter implements InfrastructureAdapter {
  readonly #vault: CredentialReader;
  readonly #fetcher: Fetcher;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #pollAttempts: number;
  readonly #pollIntervalMs: number;
  readonly #smokeAttempts: number;

  constructor(
    vault: CredentialReader,
    options: {
      fetcher?: Fetcher;
      sleep?: (milliseconds: number) => Promise<void>;
      pollAttempts?: number;
      pollIntervalMs?: number;
      smokeAttempts?: number;
    } = {}
  ) {
    this.#vault = vault;
    this.#fetcher = options.fetcher ?? fetch;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#pollAttempts = options.pollAttempts ?? 40;
    this.#pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.#smokeAttempts = options.smokeAttempts ?? 40;
  }

  async apply(preview: InfrastructureMutationPreview) {
    assertSupportedPreview(preview);
    const token = await this.#credential();
    const base = deploymentBase(preview);

    let created: CloudflareEnvelope;
    if (preview.action === "create") {
      if (await this.#projectExists(preview, token)) throw new Error("The disposable Cloudflare Pages project already exists; Codkesh will not overwrite it.");
      await this.#request(projectCollectionBase(preview), token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: preview.resourceId, production_branch: "main" }),
      });
      try {
        created = await this.#request(base, token, { method: "POST", body: disposableDeployment(preview) });
      } catch (error) {
        try {
          await this.#deleteProjectAndConfirm(preview, token);
        } catch {
          throw new Error("The disposable Cloudflare project could not be deployed and automatic cleanup could not be confirmed.");
        }
        throw error;
      }
    } else {
      await this.#request(projectBase(preview), token, { method: "GET" });
      created = await this.#request(base, token, { method: "POST" });
    }
    const deployment = asDeployment(created.result);
    if (typeof deployment.id !== "string" || deployment.id.length < 3) {
      throw new Error("Cloudflare did not return an exact deployment identifier.");
    }
    const endpoint = safePagesEndpoint(deployment.url);
    return {
      providerOperationId: deployment.id,
      endpoint,
      evidence: [
        `Cloudflare accepted deployment ${deployment.id} for approved ${preview.action === "create" ? "disposable " : ""}Pages project ${preview.resourceId}.`,
      ],
    };
  }

  async verify(
    preview: InfrastructureMutationPreview,
    applied: { providerOperationId: string; endpoint: string | null }
  ) {
    assertSupportedPreview(preview);
    assertOperationId(applied.providerOperationId);
    const token = await this.#credential();
    let status = "unknown";
    for (let attempt = 0; attempt < this.#pollAttempts; attempt += 1) {
      const observed = await this.#request(
        `${deploymentBase(preview)}/${encodeURIComponent(applied.providerOperationId)}`,
        token,
        { method: "GET" }
      );
      const deployment = asDeployment(observed.result);
      status = typeof deployment.latest_stage?.status === "string"
        ? deployment.latest_stage.status.toLowerCase()
        : "unknown";
      if (["success", "failure", "canceled"].includes(status)) break;
      if (attempt + 1 < this.#pollAttempts) await this.#sleep(this.#pollIntervalMs);
    }

    const providerPassed = status === "success";
    const checks = [{
      name: "provider deployment",
      passed: providerPassed,
      evidence: `Cloudflare reported deployment ${applied.providerOperationId} status ${status}.`,
    }];
    if (!providerPassed) return checks;

    const endpoint = requirePagesEndpoint(applied.endpoint);
    let smokeStatus: number | null = null;
    for (let attempt = 0; attempt < this.#smokeAttempts; attempt += 1) {
      try {
        const response = await this.#fetcher(endpoint, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
        smokeStatus = response.status;
        if (response.ok) break;
      } catch { smokeStatus = null; }
      if (attempt + 1 < this.#smokeAttempts) await this.#sleep(this.#pollIntervalMs);
    }
    checks.push({
      name: "https smoke check",
      passed: smokeStatus !== null && smokeStatus >= 200 && smokeStatus < 300,
      evidence: smokeStatus === null
        ? "The exact Cloudflare Pages endpoint did not complete a safe HTTPS smoke check after bounded propagation retries."
        : `The exact Cloudflare Pages endpoint responded with HTTP ${smokeStatus}.`,
    });
    return checks;
  }

  async rollback(
    preview: InfrastructureMutationPreview,
    applied: { providerOperationId: string; endpoint: string | null }
  ) {
    assertSupportedPreview(preview);
    assertOperationId(applied.providerOperationId);
    const token = await this.#credential();
    if (preview.action === "create") {
      await this.#deleteProjectAndConfirm(preview, token);
      return `Cloudflare confirmed disposable project ${preview.resourceId} is absent after rollback.`;
    }
    const exactUrl = `${deploymentBase(preview)}/${encodeURIComponent(applied.providerOperationId)}`;
    await this.#request(exactUrl, token, { method: "DELETE" });
    const absent = await this.#fetcher(exactUrl, {
      method: "GET",
      headers: cloudflareHeaders(token),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (absent.status !== 404) {
      throw new Error("Cloudflare did not confirm removal of the exact deployment.");
    }
    return `Cloudflare confirmed deployment ${applied.providerOperationId} is absent after rollback.`;
  }

  async #credential(): Promise<string> {
    const stored = await this.#vault.read(CLOUDFLARE_INFRASTRUCTURE_CREDENTIAL_REFERENCE);
    if (!stored) throw new Error("Cloudflare is not connected in Settings.");
    try {
      const parsed = JSON.parse(stored) as { secret?: unknown; accessToken?: unknown };
      const token = typeof parsed.secret === "string"
        ? parsed.secret
        : typeof parsed.accessToken === "string" ? parsed.accessToken : null;
      if (!token) throw new Error();
      return token;
    } catch {
      throw new Error("The Cloudflare connection is incomplete; reconnect it in Settings.");
    }
  }

  async #request(url: string, token: string, init: RequestInit): Promise<CloudflareEnvelope> {
    let response: Response;
    try {
      response = await this.#fetcher(url, {
        ...init,
        headers: { ...cloudflareHeaders(token), ...init.headers },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Cloudflare did not complete the bounded Pages request.");
    }
    const body = await boundedJson(response);
    if (!response.ok || body.success !== true) {
      throw new Error(`Cloudflare rejected the bounded Pages request (HTTP ${response.status}).`);
    }
    return body;
  }

  async #projectExists(preview: InfrastructureMutationPreview, token: string): Promise<boolean> {
    const response = await this.#fetcher(projectBase(preview), { method: "GET", headers: cloudflareHeaders(token), redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return false;
    const body = await boundedJson(response);
    if (!response.ok || body.success !== true) throw new Error(`Cloudflare could not verify the disposable project target (HTTP ${response.status}).`);
    return true;
  }

  async #deleteProjectAndConfirm(preview: InfrastructureMutationPreview, token: string): Promise<void> {
    await this.#request(projectBase(preview), token, { method: "DELETE" });
    const absent = await this.#fetcher(projectBase(preview), { method: "GET", headers: cloudflareHeaders(token), redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (absent.status !== 404) throw new Error("Cloudflare did not confirm removal of the exact disposable project.");
  }
}

function assertSupportedPreview(preview: InfrastructureMutationPreview): void {
  if (preview.provider !== "Cloudflare") throw new Error("This adapter only accepts Cloudflare previews.");
  if (preview.action !== "deploy" && preview.action !== "create") throw new Error("Cloudflare Pages accepts only approved deploy or disposable-create actions.");
  if (preview.region !== "global") throw new Error("Cloudflare Pages deployments must target the global region.");
  if (!preview.permissions.includes("pages:write")) throw new Error("Cloudflare Pages deployment requires pages:write authority.");
  if (!/^[a-zA-Z0-9_-]{2,200}$/.test(preview.accountId)) throw new Error("Cloudflare account target is invalid.");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(preview.resourceId)) throw new Error("Cloudflare Pages project target is invalid.");
}

function assertOperationId(value: string): void {
  if (!/^[a-zA-Z0-9-]{3,300}$/.test(value)) throw new Error("Cloudflare deployment identifier is invalid.");
}

function projectBase(preview: InfrastructureMutationPreview): string {
  return `${projectCollectionBase(preview)}/${encodeURIComponent(preview.resourceId)}`;
}

function projectCollectionBase(preview: InfrastructureMutationPreview): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(preview.accountId)}/pages/projects`;
}

function deploymentBase(preview: InfrastructureMutationPreview): string {
  return `${projectBase(preview)}/deployments`;
}

function cloudflareHeaders(token: string): Record<string, string> {
  return { Accept: "application/json", Authorization: `Bearer ${token}` };
}

function disposableDeployment(preview: InfrastructureMutationPreview): FormData {
  const marker = `codkesh-${preview.id}`;
  const worker = `export default { async fetch() { return new Response(${JSON.stringify(`<main><h1>Codkesh release verified</h1><p>${marker}</p></main>`)}, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); } };`;
  const form = new FormData();
  form.set("manifest", "{}");
  form.set("branch", "main");
  form.set("commit_dirty", "false");
  form.set("commit_hash", preview.digest.slice(0, 40));
  form.set("commit_message", "Codkesh disposable release verification");
  form.set("_worker.js", new Blob([worker], { type: "application/javascript" }), "_worker.js");
  return form;
}

function asDeployment(value: unknown): Deployment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cloudflare returned invalid deployment evidence.");
  }
  return value as Deployment;
}

function safePagesEndpoint(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Cloudflare returned an invalid deployment endpoint.");
  return requirePagesEndpoint(value);
}

function requirePagesEndpoint(value: string | null): string {
  if (!value) throw new Error("Cloudflare did not return a deployment endpoint.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.endsWith(".pages.dev")) {
    throw new Error("Cloudflare returned an unsafe deployment endpoint.");
  }
  url.hash = "";
  return url.toString();
}

async function boundedJson(response: Response): Promise<CloudflareEnvelope> {
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Cloudflare response exceeded the safe evidence limit.");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as CloudflareEnvelope;
  } catch {
    throw new Error("Cloudflare returned invalid bounded evidence.");
  }
}
