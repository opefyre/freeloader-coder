import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import type { LocalProjectRegistry } from "./local-project-registry.js";

const CONTEXT_FILE = "CONTEXT.md";
const MAX_EXISTING_BYTES = 256_000;
const DECISION_START = "<!-- accepted-decisions:start -->";
const DECISION_END = "<!-- accepted-decisions:end -->";

export class ProjectContextService {
  constructor(private readonly projects: LocalProjectRegistry) {}

  async generate(projectId: string, input: unknown) {
    const outcome = parseOutcome(input);
    const [collection, planning, root] = await Promise.all([
      this.projects.list(),
      this.projects.grounding(projectId),
      this.projects.canonicalRoot(projectId),
    ]);
    const project = collection.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("Project registration was not found.");
    const target = join(root, CONTEXT_FILE);
    const acceptedDecisions = await readAcceptedDecisions(target);
    const citations = planning.grounding.sources.map((source, index) => ({
      number: index + 1,
      path: source.path,
      digest: source.sha256,
      classification: source.classification,
    }));
    const generatedAt = new Date().toISOString();
    const body = [
      "# Project context",
      "",
      `Generated: ${generatedAt}`,
      `Project: ${project.displayName}`,
      `Evidence digest: ${planning.grounding.digest}`,
      `Topology digest: ${planning.topology.digest}`,
      "",
      "## Requested outcome",
      "",
      outcome,
      "",
      "## Facts",
      "",
      ...project.facts.map((fact) => `- ${fact.label}: ${fact.value} — ${fact.evidence}`),
      ...(project.resources ?? []).map((resource) => `- Connected ${resource.kind}: [${resource.label}](${resource.url})`),
      `- ${planning.topology.entries.length} bounded paths were classified; topology${planning.topology.truncated ? " was truncated" : " was not truncated"}.`,
      "",
      "## Inferences",
      "",
      ...project.inferences.map((value) => `- ${value}`),
      "",
      "## Assumptions",
      "",
      "- Connected-resource metadata is current only as of its recorded observation.",
      "- Source contents outside the cited root files have not been interpreted yet.",
      "",
      "## Unknowns",
      "",
      ...project.warnings.map((value) => `- ${value}`),
      ...(planning.topology.truncated ? ["- The bounded topology does not contain every project path."] : []),
      "",
      "## Accepted decisions",
      "",
      DECISION_START,
      acceptedDecisions || "- None recorded yet.",
      DECISION_END,
      "",
      "## Evidence",
      "",
      ...citations.map((citation) => `${citation.number}. \`${citation.path}\` — ${citation.classification}; SHA-256 \`${citation.digest}\``),
      "",
      "## Boundaries",
      "",
      ...planning.grounding.limitations.map((value) => `- ${value}`),
      ...planning.topology.limitations.map((value) => `- ${value}`),
      "- Secrets, excluded directories, symlinks, provider prompts, and command output are not included.",
      "",
    ].join("\n");
    const digest = createHash("sha256").update(body).digest("hex");
    await atomicWrite(target, `${body}\n<!-- context-digest:${digest} -->\n`);
    return { schemaVersion: 1 as const, projectId, path: CONTEXT_FILE, digest, groundingDigest: planning.grounding.digest, topologyDigest: planning.topology.digest, observedAt: Date.now(), citations: citations.map(({ path, digest: sourceDigest }) => ({ path, digest: sourceDigest })) };
  }
}

function parseOutcome(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Context request is invalid.");
  const value = (input as Record<string, unknown>).outcome;
  if (typeof value !== "string" || value.trim().length < 3 || value.length > 20_000) throw new Error("Context outcome is invalid.");
  return value.trim();
}

async function readAcceptedDecisions(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_EXISTING_BYTES) return "";
    const content = await readFile(path, "utf8");
    const start = content.indexOf(DECISION_START);
    const end = content.indexOf(DECISION_END);
    if (start < 0 || end <= start) return "";
    return content.slice(start + DECISION_START.length, end).trim().slice(0, 32_000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await chmod(path, 0o600);
}
