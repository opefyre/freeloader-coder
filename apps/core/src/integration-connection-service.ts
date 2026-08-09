import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  publicIntegrationConnectionCollectionSchema,
  type PublicIntegrationConnectionCollection,
} from "../../../packages/runtime/src/integration-connections.js";

const execFileAsync = promisify(execFile);

type Runner = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

export class IntegrationConnectionService {
  readonly #runner: Runner;
  #last: PublicIntegrationConnectionCollection | null = null;

  constructor(runner: Runner = safeExec) {
    this.#runner = runner;
  }

  async list(): Promise<PublicIntegrationConnectionCollection> {
    return this.#last ?? this.#empty("Choose Detect to use the GitHub login already stored by GitHub CLI.");
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
      this.#last = publicIntegrationConnectionCollectionSchema.parse({
        schemaVersion: 1,
        provenance: "local_observation",
        observedAt,
        connections: [{
          schemaVersion: 1,
          provider: "github",
          state: "ready",
          accountLabel,
          authMethod: "github_cli_oauth",
          observedAt,
          resources,
          nextAction: resources.length > 0 ? "Choose repositories inside a project." : "Grant GitHub CLI access to at least one repository.",
        }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const unavailable = /ENOENT|not found|spawn gh/i.test(message);
      this.#last = this.#empty(
        unavailable ? "Install GitHub CLI, then sign in once." : "Sign in with GitHub CLI, then choose Detect again.",
        unavailable ? "unavailable" : "not_connected"
      );
    }
    return this.#last;
  }

  #empty(nextAction: string, state: "not_connected" | "unavailable" = "not_connected") {
    const observedAt = Date.now();
    return publicIntegrationConnectionCollectionSchema.parse({
      schemaVersion: 1, provenance: "local_observation", observedAt,
      connections: [{ schemaVersion: 1, provider: "github", state, accountLabel: null, authMethod: "github_cli_oauth", observedAt, resources: [], nextAction }],
    });
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
