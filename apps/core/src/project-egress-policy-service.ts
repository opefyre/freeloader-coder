import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { projectEgressPermitSchema, type ProjectEgressPermit } from "../../../packages/orchestration/src/solution-design.js";

export { projectEgressPermitSchema, type ProjectEgressPermit };

const grantSchema = z.strictObject({
  schemaVersion: z.literal(1),
  contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
  dataClass: z.enum(["non_personal_test", "source_code"]),
  providerIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  expiresAt: z.number().int().positive(),
  acknowledgment: z.literal("I authorize this exact project context for the selected free providers."),
});
const stateSchema = z.strictObject({ schemaVersion: z.literal(1), permits: z.record(z.string(), projectEgressPermitSchema) });

export class ProjectEgressPolicyService {
  readonly #path: string;
  #mutation = Promise.resolve();
  constructor(
    stateDirectory: string,
    private readonly now: () => number = Date.now,
    private readonly defaultFreeProviders?: () => Promise<readonly string[]>
  ) { this.#path = resolve(stateDirectory, "project-egress-policies.json"); }

  async grant(projectId: string, raw: unknown): Promise<ProjectEgressPermit> {
    assertProjectId(projectId);
    const input = grantSchema.parse(raw);
    const now = this.now();
    if (input.expiresAt <= now || input.expiresAt > now + 31 * 86_400_000) throw new Error("Project provider consent must expire within 31 days.");
    return this.#mutate(async (state) => {
      const permit = projectEgressPermitSchema.parse({ schemaVersion: 1, projectId, contextDigest: input.contextDigest, dataClass: input.dataClass, providerIds: [...new Set(input.providerIds)].sort(), approvedAt: now, expiresAt: input.expiresAt });
      return { state: { ...state, permits: { ...state.permits, [projectId]: permit } }, result: permit };
    });
  }

  async revoke(projectId: string): Promise<void> {
    assertProjectId(projectId);
    await this.#mutate(async (state) => { const permits = { ...state.permits }; delete permits[projectId]; return { state: { ...state, permits }, result: undefined }; });
  }

  async authorize(projectId: string, contextDigest: string): Promise<ProjectEgressPermit> {
    assertProjectId(projectId);
    const permit = (await this.#load()).permits[projectId];
    if (permit && permit.expiresAt > this.now() && permit.contextDigest === contextDigest) return permit;
    if (!this.defaultFreeProviders) {
      if (!permit) throw new ProjectEgressDeniedError("Approve provider use for this project before solution research.");
      if (permit.expiresAt <= this.now()) throw new ProjectEgressDeniedError("Project provider consent expired. Review and approve it again.");
      throw new ProjectEgressDeniedError("Project context changed after consent. Review the updated context before sharing it.");
    }
    const providerIds = [...new Set(await this.defaultFreeProviders())].sort();
    if (providerIds.length === 0) throw new ProjectEgressDeniedError("No eligible free provider is currently available. Codkesh will retry provider checks automatically.");
    const now = this.now();
    return this.#mutate(async (state) => {
      const refreshed = projectEgressPermitSchema.parse({
        schemaVersion: 1,
        projectId,
        contextDigest,
        dataClass: "source_code",
        providerIds,
        approvedAt: now,
        expiresAt: now + 31 * 86_400_000,
      });
      return { state: { ...state, permits: { ...state.permits, [projectId]: refreshed } }, result: refreshed };
    });
  }

  async get(projectId: string): Promise<ProjectEgressPermit | null> { assertProjectId(projectId); return (await this.#load()).permits[projectId] ?? null; }

  async #mutate<T>(operation: (state: z.infer<typeof stateSchema>) => Promise<{ state: z.infer<typeof stateSchema>; result: T }>) {
    let result!: T;
    const next = this.#mutation.then(async () => { const outcome = await operation(await this.#load()); await atomicWrite(this.#path, `${JSON.stringify(stateSchema.parse(outcome.state), null, 2)}\n`); result = outcome.result; });
    this.#mutation = next.catch(() => undefined); await next; return result;
  }
  async #load() { try { return stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateSchema.parse({ schemaVersion: 1, permits: {} }); throw new Error("Project provider consent state is corrupt."); } }
}

export class ProjectEgressDeniedError extends Error {}
function assertProjectId(value: string) { if (!/^project_[a-f0-9]{16}$/.test(value)) throw new Error("Project identity is invalid."); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
