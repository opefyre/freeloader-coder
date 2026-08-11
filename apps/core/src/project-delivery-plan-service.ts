import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { deliveryPlanDocumentSchema, deliveryPlanDraftSchema, type DeliveryPlanDocument } from "../../../packages/orchestration/src/delivery-plan.js";
import { projectArtifactSchema } from "../../../packages/orchestration/src/project-lifecycle.js";
import type { LocalProjectRegistry } from "./local-project-registry.js";
import { ProjectArtifactStore } from "./project-artifact-store.js";

export class ProjectDeliveryPlanService {
  constructor(
    private readonly projects: LocalProjectRegistry,
    private readonly artifacts = new ProjectArtifactStore(),
  ) {}

  async publish(projectId: string, raw: unknown, now = Date.now()) {
    const draft = deliveryPlanDraftSchema.parse(raw);
    const delivery = draft.reviews.find((review) => review.discipline === "delivery");
    const technical = draft.reviews.find((review) => review.discipline === "technical");
    if (!delivery || !technical || delivery.reviewerId === technical.reviewerId) throw new Error("Backlog publication requires independent delivery and technical reviews.");
    const root = await this.projects.canonicalRoot(projectId);
    await this.artifacts.initialize(root);
    const current = await this.artifacts.read(root, "delivery_plan");
    const target = join(root, ".pipeline", "BACKLOG.md");
    const planTarget = join(root, ".pipeline", "BACKLOG.plan.json");
    const revision = readRevision(current.body) + 1;
    if (draft.revision !== revision) throw new Error(`Backlog revision must be ${revision}.`);
    const body = `${renderBacklog(draft)}\n<!-- delivery-plan-revision:${draft.revision};items:${draft.items.length} -->`;
    const written = await this.artifacts.write(root, { kind: "delivery_plan", body, producer: "codkesh:delivery-planning", expectedDigest: current.metadata.bodyDigest });
    await atomicWrite(planTarget, `${JSON.stringify({ ...draft, documentDigest: written.metadata.bodyDigest }, null, 2)}\n`);
    await atomicWrite(target, `${body}\n<!-- canonical-delivery-plan-digest:${written.metadata.bodyDigest} -->\n`);
    return projectArtifactSchema.parse({ kind: "backlog", projectRelativePath: ".pipeline/BACKLOG.md", digest: written.metadata.bodyDigest, revision: draft.revision, createdAt: now, citations: [...new Set(draft.citations)], reviewerIds: [delivery.reviewerId, technical.reviewerId], qaPassed: true });
  }

  async read(projectId: string): Promise<DeliveryPlanDocument> {
    const artifact = await this.artifacts.read(await this.projects.canonicalRoot(projectId), "delivery_plan");
    const match = artifact.body.match(/<!-- delivery-plan-revision:(\d+);items:(\d+) -->\s*$/);
    if (!match) throw Object.assign(new Error("Delivery plan was not published yet."), { code: "ENOENT" });
    return deliveryPlanDocumentSchema.parse({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/BACKLOG.md", revision: Number(match[1]), digest: artifact.metadata.bodyDigest, markdown: artifact.body, itemCount: Number(match[2]) });
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
  const lines = [`# ${draft.title}`, "", draft.objective, "", `Context: \`${draft.contextDigest}\``, `Solution: \`${draft.solutionDigest}\``, "", "## Requirement coverage", "", ...draft.coverage.map((entry) => `- **${entry.requirement}** → ${entry.itemIds.map((id) => `\`${id}\``).join(", ")} · checks: ${entry.validationProfiles.join(", ")} · sources: ${entry.citations.join(", ")}`), "", "## Delivery gates", "", ...draft.gates.map((gate) => `- **${gate.kind} · ${gate.title}** before ${gate.beforeItemIds.map((id) => `\`${id}\``).join(", ")}: ${gate.rationale}`), ""];
  for (const item of draft.items) lines.push(`## ${item.type.toUpperCase()} · ${item.title}`, "", `ID: \`${item.id}\``, `Parent: ${item.parentId ? `\`${item.parentId}\`` : "None"}`, `Priority: ${item.priority}`, `Estimate: ${item.estimatedMinutes} minutes${item.storyPoints ? ` · ${item.storyPoints} points` : ""}`, `Depends on: ${item.dependencies.length ? item.dependencies.map((id) => `\`${id}\``).join(", ") : "None"}`, `Capabilities: ${item.roleCapabilities.join(", ")}`, `Allowed files: ${item.allowedFiles.length ? item.allowedFiles.map((file) => `\`${file}\``).join(", ") : "None"}`, `Validation: ${item.validationProfiles.length ? item.validationProfiles.join(", ") : "None"}`, "", item.description, "", "### Acceptance criteria", "", ...item.acceptanceCriteria.map((entry) => `- ${entry}`), "", "### Definition of Done", "", ...item.definitionOfDone.map((entry) => `- ${entry}`), "", "### Implementation notes", "", ...item.implementationNotes.map((entry) => `- ${entry}`), "", "### Rollback requirements", "", ...item.rollbackRequirements.map((entry) => `- ${entry}`), "", "### Sources", "", ...item.citations.map((entry) => `- ${entry}`), "");
  lines.push("## Risks", "", ...draft.risks.map((entry) => `- ${entry}`), "", "## Assumptions", "", ...(draft.assumptions.length ? draft.assumptions.map((entry) => `- ${entry}`) : ["- None."]), "", "## Source index", "", ...draft.citations.map((entry, index) => `${index + 1}. ${entry}`), "", "## Independent QA", "", ...draft.reviews.map((review) => `- ${review.discipline} — ${review.reviewerId}: passed${review.findings.length ? `; ${review.findings.join("; ")}` : ""}`), "");
  return lines.join("\n");
}

function readRevision(body: string) {
  const match = body.match(/<!-- delivery-plan-revision:(\d+);items:\d+ -->\s*$/);
  return match ? Number(match[1]) : 0;
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path); await chmod(path, 0o600);
}
