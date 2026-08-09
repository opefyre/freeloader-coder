import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LocalProjectRegistry } from "./local-project-registry.js";
import { projectArtifactSchema } from "../../../packages/orchestration/src/project-lifecycle.js";
import { solutionDocumentSchema, solutionDraftSchema, type SolutionDocument } from "../../../packages/orchestration/src/solution-design.js";

export class ProjectSolutionService {
  constructor(private readonly projects: LocalProjectRegistry) {}

  async publish(projectId: string, raw: unknown, now = Date.now()) {
    const draft = solutionDraftSchema.parse(raw);
    const product = draft.reviews.find((review) => review.discipline === "product");
    const technical = draft.reviews.find((review) => review.discipline === "technical");
    if (!product || !technical || product.reviewerId === technical.reviewerId) {
      throw new Error("Solution publication requires independent product and technical reviews.");
    }
    const root = await this.projects.canonicalRoot(projectId);
    const target = join(root, ".pipeline", "SOLUTION.md");
    const currentRevision = await readRevision(target);
    if (draft.revision !== currentRevision + 1) throw new Error(`Solution revision must be ${currentRevision + 1}.`);
    const citations = [...new Set(draft.citations)];
    const body = [
      `# ${draft.title}`, "", draft.summary, "",
      ...renderSection("Product behavior", draft.behavior),
      ...renderSection("Architecture", draft.architecture),
      ...renderSection("User experience", draft.userExperience),
      ...renderSection("Data", draft.data),
      ...renderSection("Integrations", draft.integrations),
      ...renderSection("Security", draft.security),
      ...renderSection("Privacy", draft.privacy),
      ...renderSection("Reliability", draft.reliability),
      ...renderSection("Rollout", draft.rollout),
      ...renderSection("Success metrics", draft.metrics),
      "## Sources", "", ...citations.map((citation, index) => `${index + 1}. ${citation}`), "",
      "## Independent review", "",
      `- Product — ${product.reviewerId}: passed${product.findings.length ? `; ${product.findings.join("; ")}` : ""}`,
      `- Technical — ${technical.reviewerId}: passed${technical.findings.length ? `; ${technical.findings.join("; ")}` : ""}`,
      "",
    ].join("\n");
    const digest = createHash("sha256").update(body).digest("hex");
    await atomicWrite(target, `${body}\n<!-- solution-revision:${draft.revision};digest:${digest} -->\n`);
    return projectArtifactSchema.parse({ kind: "solution", projectRelativePath: ".pipeline/SOLUTION.md", digest, revision: draft.revision, createdAt: now, citations, reviewerIds: [product.reviewerId, technical.reviewerId], qaPassed: true });
  }

  async read(projectId: string): Promise<SolutionDocument> {
    const target = join(await this.projects.canonicalRoot(projectId), ".pipeline", "SOLUTION.md");
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1_000_000) throw new Error("Solution artifact is not safely readable.");
    const content = await readFile(target, "utf8");
    const match = content.match(/\n<!-- solution-revision:(\d+);digest:([a-f0-9]{64}) -->\s*$/);
    if (!match) throw new Error("Solution artifact is missing revision evidence.");
    const markdown = content.slice(0, match.index).replace(/\n+$/, "");
    if (createHash("sha256").update(`${markdown}\n`).digest("hex") !== match[2]) throw new Error("Solution artifact digest does not match its content.");
    return solutionDocumentSchema.parse({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision: Number(match[1]), digest: match[2], markdown });
  }
}

function renderSection(title: string, entries: readonly string[]) {
  return [`## ${title}`, "", ...entries.map((entry) => `- ${entry}`), ""];
}

async function readRevision(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1_000_000) throw new Error("Existing solution artifact is not safely readable.");
    const content = await readFile(path, "utf8");
    const match = content.match(/<!-- solution-revision:(\d+);digest:[a-f0-9]{64} -->\s*$/);
    if (!match) throw new Error("Existing solution artifact is missing revision evidence.");
    return Number(match[1]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
  await chmod(path, 0o600);
}
