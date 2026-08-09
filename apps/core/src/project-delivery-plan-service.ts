import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { deliveryPlanDocumentSchema, deliveryPlanDraftSchema, type DeliveryPlanDocument } from "../../../packages/orchestration/src/delivery-plan.js";
import { projectArtifactSchema } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { LocalProjectRegistry } from "./local-project-registry.js";

export class ProjectDeliveryPlanService {
  constructor(private readonly projects: LocalProjectRegistry) {}

  async publish(projectId: string, raw: unknown, now = Date.now()) {
    const draft = deliveryPlanDraftSchema.parse(raw);
    const delivery = draft.reviews.find((review) => review.discipline === "delivery");
    const technical = draft.reviews.find((review) => review.discipline === "technical");
    if (!delivery || !technical || delivery.reviewerId === technical.reviewerId) throw new Error("Backlog publication requires independent delivery and technical reviews.");
    const target = join(await this.projects.canonicalRoot(projectId), ".pipeline", "BACKLOG.md");
    const planTarget = join(await this.projects.canonicalRoot(projectId), ".pipeline", "BACKLOG.plan.json");
    const revision = await readRevision(target) + 1;
    if (draft.revision !== revision) throw new Error(`Backlog revision must be ${revision}.`);
    const body = renderBacklog(draft);
    const digest = createHash("sha256").update(body).digest("hex");
    await atomicWrite(planTarget, `${JSON.stringify({ ...draft, documentDigest: digest }, null, 2)}\n`);
    await atomicWrite(target, `${body}\n<!-- backlog-revision:${draft.revision};digest:${digest};items:${draft.items.length} -->\n`);
    return projectArtifactSchema.parse({ kind: "backlog", projectRelativePath: ".pipeline/BACKLOG.md", digest, revision: draft.revision, createdAt: now, citations: [...new Set(draft.citations)], reviewerIds: [delivery.reviewerId, technical.reviewerId], qaPassed: true });
  }

  async read(projectId: string): Promise<DeliveryPlanDocument> {
    const target = join(await this.projects.canonicalRoot(projectId), ".pipeline", "BACKLOG.md");
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4_000_000) throw new Error("Backlog artifact is not safely readable.");
    const content = await readFile(target, "utf8");
    const match = content.match(/\n<!-- backlog-revision:(\d+);digest:([a-f0-9]{64});items:(\d+) -->\s*$/);
    if (!match) throw new Error("Backlog artifact is missing revision evidence.");
    const markdown = content.slice(0, match.index).replace(/\n+$/, "");
    if (createHash("sha256").update(`${markdown}\n`).digest("hex") !== match[2]) throw new Error("Backlog artifact digest does not match its content.");
    return deliveryPlanDocumentSchema.parse({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: Number(match[1]), digest: match[2], markdown, itemCount: Number(match[3]) });
  }

  async readDraft(projectId: string) {
    const target = join(await this.projects.canonicalRoot(projectId), ".pipeline", "BACKLOG.plan.json");
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4_000_000) throw new Error("Delivery plan source is not safely readable.");
    const raw = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
    const documentDigest = raw.documentDigest;
    delete raw.documentDigest;
    const draft = deliveryPlanDraftSchema.parse(raw);
    if (typeof documentDigest !== "string") throw new Error("Delivery plan source is missing document evidence.");
    const document = await this.read(projectId);
    if (document.digest !== documentDigest || document.revision !== draft.revision || document.itemCount !== draft.items.length) {
      throw new Error("Delivery plan source does not match the reviewed backlog artifact.");
    }
    return { draft, document };
  }
}

function renderBacklog(draft: ReturnType<typeof deliveryPlanDraftSchema.parse>) {
  const lines = [`# ${draft.title}`, "", draft.objective, "", `Context: \`${draft.contextDigest}\``, `Solution: \`${draft.solutionDigest}\``, ""];
  for (const item of draft.items) lines.push(`## ${item.type.toUpperCase()} · ${item.title}`, "", `ID: \`${item.id}\``, `Parent: ${item.parentId ? `\`${item.parentId}\`` : "None"}`, `Priority: ${item.priority}`, `Estimate: ${item.estimatedMinutes} minutes${item.storyPoints ? ` · ${item.storyPoints} points` : ""}`, `Depends on: ${item.dependencies.length ? item.dependencies.map((id) => `\`${id}\``).join(", ") : "None"}`, "", item.description, "", "### Acceptance criteria", "", ...item.acceptanceCriteria.map((entry) => `- ${entry}`), "", "### Definition of Done", "", ...item.definitionOfDone.map((entry) => `- ${entry}`), "", "### Implementation notes", "", ...item.implementationNotes.map((entry) => `- ${entry}`), "", "### Sources", "", ...item.citations.map((entry) => `- ${entry}`), "");
  lines.push("## Risks", "", ...draft.risks.map((entry) => `- ${entry}`), "", "## Assumptions", "", ...(draft.assumptions.length ? draft.assumptions.map((entry) => `- ${entry}`) : ["- None."]), "", "## Source index", "", ...draft.citations.map((entry, index) => `${index + 1}. ${entry}`), "", "## Independent QA", "", ...draft.reviews.map((review) => `- ${review.discipline} — ${review.reviewerId}: passed${review.findings.length ? `; ${review.findings.join("; ")}` : ""}`), "");
  return lines.join("\n");
}

async function readRevision(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4_000_000) throw new Error("Existing backlog artifact is not safely readable.");
    const content = await readFile(path, "utf8");
    const match = content.match(/<!-- backlog-revision:(\d+);digest:[a-f0-9]{64};items:\d+ -->\s*$/);
    if (!match) throw new Error("Existing backlog artifact is missing revision evidence.");
    return Number(match[1]);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path); await chmod(path, 0o600);
}
