import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { LocalProjectRegistry } from "./local-project-registry.js";
import { ProjectArtifactStore } from "./project-artifact-store.js";
import { projectArtifactSchema } from "../../../packages/orchestration/src/project-lifecycle.js";
import { researchEvidenceGraphSchema, solutionContentSchema, solutionDocumentSchema, solutionDraftSchema, type ResearchEvidenceGraph, type SolutionContent, type SolutionDocument } from "../../../packages/orchestration/src/solution-design.js";

export class ProjectSolutionService {
  constructor(
    private readonly projects: LocalProjectRegistry,
    private readonly artifacts = new ProjectArtifactStore(),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async publishResearch(projectId: string, input: {
    contextDigest: string;
    product: { providerId: string; modelId: string; response: unknown };
    technical: { providerId: string; modelId: string; response: unknown };
  }) {
    if (!/^[a-f0-9]{64}$/.test(input.contextDigest)) throw new Error("Research context digest is invalid.");
    const root = await this.projects.canonicalRoot(projectId);
    await this.artifacts.initialize(root);
    const current = await this.artifacts.read(root, "research");
    const product = researchEvidenceGraphSchema.parse(input.product.response);
    const technical = researchEvidenceGraphSchema.parse(input.technical.response);
    if (product.discipline !== "product" || technical.discipline !== "technical") throw new Error("Research specialists returned mismatched disciplines.");
    await this.verifyResearchSources([...product.sources, ...technical.sources]);
    const body = [
      "# Research", "",
      "## Grounding", "",
      `- CONTEXT.md digest: \`${input.contextDigest}\``,
      "- Status: validated specialist evidence captured; reconciliation and independent review remain separate gates.", "",
      ...renderResearch("Product, market, and user analysis", input.product, product),
      ...renderResearch("Technical and delivery analysis", input.technical, technical),
      "## Evidence boundary", "",
      "- Provider and model identities are recorded for traceability.",
      "- This file records specialist evidence, not an approved product or technical decision.",
    ].join("\n");
    return this.artifacts.write(root, {
      kind: "research", body, producer: "codkesh:solution-research",
      expectedDigest: current.metadata.bodyDigest,
    });
  }

  private async verifyResearchSources(sources: readonly ResearchEvidenceGraph["sources"][number][]) {
    for (const source of sources) {
      const url = new URL(source.url);
      if (isPrivateResearchHost(url.hostname)) throw new Error("Research citations cannot target private or loopback hosts.");
      if (createHash("sha256").update(source.excerpt).digest("hex") !== source.excerptDigest) throw new Error("Research excerpt digest does not match its cited excerpt.");
      const response = await this.fetcher(url, { method: "GET", redirect: "error", headers: { Accept: "text/html,text/plain,application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Research citation could not be verified (${response.status}).`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/") && !contentType.includes("json")) throw new Error("Research citation returned an unsupported content type.");
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) throw new Error("Research citation is too large to verify safely.");
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error("Research citation is too large to verify safely.");
      if (!normalizeEvidence(body).includes(normalizeEvidence(source.excerpt))) throw new Error("Research excerpt was not found in the cited source.");
    }
  }

  async recordDecision(projectId: string, raw: unknown, idempotencyKey: string, now = Date.now()) {
    const input = z.strictObject({
      schemaVersion: z.literal(1),
      expectedRevision: z.number().int().nonnegative(),
      artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(["approved", "declined", "revision_requested"]),
      feedback: z.string().trim().min(3).max(10_000).nullable(),
    }).parse(raw);
    if (!/^[a-z0-9:._-]{8,200}$/i.test(idempotencyKey)) throw new Error("Solution decision idempotency key is invalid.");
    if (input.decision === "revision_requested" && !input.feedback?.trim()) throw new Error("A revision request requires feedback.");
    if (input.decision !== "revision_requested" && input.feedback !== null) throw new Error("Feedback is accepted only for a revision request.");
    const root = await this.projects.canonicalRoot(projectId);
    await this.artifacts.initialize(root);
    let design = await this.artifacts.read(root, "design");
    if (design.metadata.bodyDigest !== input.artifactDigest) throw new Error("The solution changed. Review the latest design before deciding.");
    const marker = `decision:${createHash("sha256").update(`${projectId}:${idempotencyKey}`).digest("hex").slice(0, 24)}`;
    let product = await this.artifacts.read(root, "product");
    let decisions = await this.artifacts.read(root, "decisions");
    let status = await this.artifacts.read(root, "status");
    if (input.decision === "approved") {
      if (design.metadata.approvedDigest !== design.metadata.bodyDigest) {
        design = await this.artifacts.write(root, { kind: "design", body: design.body, producer: "owner:solution-approval", expectedDigest: design.metadata.bodyDigest, approvedDigest: design.metadata.bodyDigest });
      }
      if (product.metadata.approvedDigest !== product.metadata.bodyDigest) {
        product = await this.artifacts.write(root, { kind: "product", body: product.body, producer: "owner:solution-approval", expectedDigest: product.metadata.bodyDigest, approvedDigest: product.metadata.bodyDigest });
      }
    }
    if (!decisions.body.includes(`<!-- ${marker} -->`)) {
      const feedback = input.feedback ? `\n  - Requested changes: ${input.feedback.trim()}` : "";
      decisions = await this.artifacts.write(root, {
        kind: "decisions",
        body: `${decisions.body}\n\n- ${new Date(now).toISOString()} — Solution **${input.decision.replaceAll("_", " ")}**\n  - Design digest: \`${input.artifactDigest}\`${feedback}\n  <!-- ${marker} -->`,
        producer: "owner:solution-decision",
        expectedDigest: decisions.metadata.bodyDigest,
      });
    }
    if (!status.body.includes(`<!-- ${marker} -->`)) {
      const next = input.decision === "approved" ? "Generate and independently validate the delivery plan."
        : input.decision === "revision_requested" ? "Revise research, product, and design artifacts using the owner's requested changes."
          : "No further work is authorized for this solution.";
      status = await this.artifacts.write(root, {
        kind: "status",
        body: ["# Project status", "", "## Current milestone", "", `Solution ${input.decision.replaceAll("_", " ")}.`, "", "## Active work", "", input.decision === "revision_requested" ? "Solution revision is pending." : "_No active implementation work._", "", "## Blockers and owner actions", "", input.decision === "revision_requested" ? `- Apply owner feedback: ${input.feedback?.trim()}` : "_No owner action is currently required._", "", "## Next action", "", next, "", `<!-- ${marker} -->`].join("\n"),
        producer: "codkesh:solution-decision",
        expectedDigest: status.metadata.bodyDigest,
      });
    }
    return { design, product, decisions, status };
  }

  async publish(projectId: string, raw: unknown, now = Date.now()) {
    const draft = solutionDraftSchema.parse(raw);
    const product = draft.reviews.find((review) => review.discipline === "product");
    const technical = draft.reviews.find((review) => review.discipline === "technical");
    if (!product || !technical || product.reviewerId === technical.reviewerId) {
      throw new Error("Solution publication requires independent product and technical reviews.");
    }
    const root = await this.projects.canonicalRoot(projectId);
    await this.artifacts.initialize(root);
    const currentDesign = await this.artifacts.read(root, "design");
    const currentProduct = await this.artifacts.read(root, "product");
    const currentContext = await this.artifacts.read(root, "context");
    const currentResearch = await this.artifacts.read(root, "research");
    assertResearchBaseline(draft.citations, currentResearch.body);
    const currentRevision = readSolutionRevision(currentDesign.body);
    if (draft.revision !== currentRevision + 1) throw new Error(`Solution revision must be ${currentRevision + 1}.`);
    const citations = [...new Set(draft.citations)];
    const contentPayload = solutionContentSchema.parse({
      schemaVersion: 1, title: draft.title, summary: draft.summary, behavior: draft.behavior,
      architecture: draft.architecture, userExperience: draft.userExperience, data: draft.data,
      integrations: draft.integrations, security: draft.security, privacy: draft.privacy,
      reliability: draft.reliability, rollout: draft.rollout, metrics: draft.metrics, citations,
      alternatives: draft.alternatives, unresolvedBlockers: draft.unresolvedBlockers,
    });
    const evidenceBaseline = [`- CONTEXT.md: \`${currentContext.metadata.bodyDigest}\``, `- RESEARCH.md: \`${currentResearch.metadata.bodyDigest}\``];
    const productBody = [
      `# Product — ${draft.title}`, "", draft.summary, "",
      "## Evidence baseline", "", ...evidenceBaseline, "",
      ...renderSection("Product behavior", draft.behavior),
      ...renderSection("User experience", draft.userExperience),
      ...renderSection("Rollout", draft.rollout),
      ...renderSection("Success metrics", draft.metrics),
      ...renderAlternatives(draft.alternatives),
      ...renderBlockers(draft.unresolvedBlockers),
      "## Sources", "", ...citations.map((citation, index) => `${index + 1}. ${citation}`), "",
      `<!-- solution-revision:${draft.revision} -->`,
    ].join("\n");
    const designBody = [
      `# ${draft.title}`, "", draft.summary, "",
      "## Evidence baseline", "", ...evidenceBaseline, "",
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
      ...renderAlternatives(draft.alternatives),
      ...renderBlockers(draft.unresolvedBlockers),
      "## Sources", "", ...citations.map((citation, index) => `${index + 1}. ${citation}`), "",
      "## Independent review", "",
      `- Product — ${product.reviewerId}: passed${product.findings.length ? `; ${product.findings.join("; ")}` : ""}`,
      `- Technical — ${technical.reviewerId}: passed${technical.findings.length ? `; ${technical.findings.join("; ")}` : ""}`,
      "", `<!-- solution-content:${Buffer.from(JSON.stringify(contentPayload)).toString("base64")} -->`,
      `<!-- solution-revision:${draft.revision} -->`,
    ].join("\n");
    assertSolutionConsistency(productBody, designBody, contentPayload, currentContext.metadata.bodyDigest, currentResearch.metadata.bodyDigest);
    await this.artifacts.write(root, {
      kind: "product", body: productBody, producer: "codkesh:solution-design",
      expectedDigest: currentProduct.metadata.bodyDigest,
    });
    const design = await this.artifacts.write(root, {
      kind: "design", body: designBody, producer: "codkesh:solution-design",
      expectedDigest: currentDesign.metadata.bodyDigest,
    });
    await atomicWrite(join(root, ".pipeline", "SOLUTION.md"), compatibilityProjection(designBody, design.metadata.bodyDigest));
    return projectArtifactSchema.parse({ kind: "solution", projectRelativePath: ".pipeline/SOLUTION.md", digest: design.metadata.bodyDigest, revision: draft.revision, createdAt: now, citations, reviewerIds: [product.reviewerId, technical.reviewerId], qaPassed: true });
  }

  async read(projectId: string): Promise<SolutionDocument> {
    const design = await this.artifacts.read(await this.projects.canonicalRoot(projectId), "design");
    const revision = readSolutionRevision(design.body);
    if (revision < 1) throw Object.assign(new Error("Solution artifact was not published yet."), { code: "ENOENT" });
    return solutionDocumentSchema.parse({ schemaVersion: 1, projectId, projectRelativePath: ".pipeline/SOLUTION.md", revision, digest: design.metadata.bodyDigest, markdown: design.body });
  }

  async readContent(projectId: string): Promise<SolutionContent> {
    const design = await this.artifacts.read(await this.projects.canonicalRoot(projectId), "design");
    const match = design.body.match(/<!-- solution-content:([A-Za-z0-9+/=]+) -->/);
    if (!match) throw Object.assign(new Error("Structured solution content was not published yet."), { code: "ENOENT" });
    try {
      return solutionContentSchema.parse(JSON.parse(Buffer.from(match[1]!, "base64").toString("utf8")));
    } catch {
      throw new Error("Structured solution content is corrupt.");
    }
  }
}

function renderSection(title: string, entries: readonly string[]) {
  return [`## ${title}`, "", ...entries.map((entry) => `- ${entry}`), ""];
}

function renderAlternatives(alternatives: readonly { option: string; disposition: "selected" | "rejected" | "deferred"; rationale: string }[]) {
  return ["## Alternatives and decisions", "", ...alternatives.map((item) => `- **${item.disposition}** — ${item.option} — ${item.rationale}`), ""];
}

function renderBlockers(blockers: readonly { blocker: string; impact: string; owner: string; resolution: string }[]) {
  return ["## Unresolved blockers", "", ...(blockers.length ? blockers.map((item) => `- **${item.blocker}** — Impact: ${item.impact} Owner: ${item.owner}. Resolution: ${item.resolution}`) : ["_No unresolved blockers._"]), ""];
}

function assertResearchBaseline(citations: readonly string[], research: string) {
  if (!citations.includes("local://CONTEXT.md") || !citations.includes("local://RESEARCH.md")) throw new Error("Solution citations must include the canonical CONTEXT.md and RESEARCH.md baselines.");
  if (research.includes("Research has not started")) throw new Error("Verified research must exist before solution synthesis.");
  for (const citation of citations.filter((item) => /^https?:\/\//i.test(item))) if (!research.includes(citation)) throw new Error("Solution contains an external citation that is not present in verified RESEARCH.md.");
}

function assertSolutionConsistency(product: string, design: string, content: SolutionContent, contextDigest: string, researchDigest: string) {
  for (const digest of [contextDigest, researchDigest]) if (!product.includes(digest) || !design.includes(digest)) throw new Error("Solution artifacts do not share the same evidence baseline.");
  for (const entry of [...content.behavior, ...content.userExperience, ...content.rollout, ...content.metrics]) if (!product.includes(entry) || !design.includes(entry)) throw new Error("PRODUCT.md and DESIGN.md are inconsistent.");
  for (const alternative of content.alternatives) if (!product.includes(alternative.option) || !design.includes(alternative.option)) throw new Error("Solution alternatives are not recorded consistently.");
  for (const blocker of content.unresolvedBlockers) if (!product.includes(blocker.blocker) || !design.includes(blocker.blocker)) throw new Error("Solution blockers are not recorded consistently.");
}

function renderResearch(title: string, evidence: { providerId: string; modelId: string; response: unknown }, graph: ResearchEvidenceGraph) {
  const provider = evidence.providerId.trim();
  const model = evidence.modelId.trim();
  if (!provider || !model || provider.length > 120 || model.length > 200) throw new Error("Research model identity is invalid.");
  const sourceMap = new Map(graph.sources.map((source) => [source.sourceId, source]));
  return [
    `## ${title}`, "", `- Provider: \`${provider}\``, `- Model: \`${model}\``, "",
    "### Verified claims", "",
    ...(graph.claims.length ? graph.claims.flatMap((claim) => [
      `- **${claim.topic.replaceAll("_", " ")}** — ${claim.statement}`,
      `  - Confidence: ${Math.round(claim.confidence * 100)}% · relevance: ${Math.round(claim.relevance * 100)}%`,
      `  - Sources: ${claim.sourceIds.map((id) => { const source = sourceMap.get(id)!; return `[${source.title}](${source.url}) (retrieved ${source.retrievedAt}; excerpt \`${source.excerptDigest}\`; ${source.freshness})`; }).join("; ")}`,
    ]) : ["_No verified claims._"]), "",
    "### Contradictions", "",
    ...(graph.contradictions.length ? graph.contradictions.map((item) => `- ${item.summary} (claims: ${item.claimIds.join(", ")})`) : ["_No source contradictions detected._"]), "",
    "### Evidence gaps", "",
    ...(graph.gaps.length ? graph.gaps.map((gap) => `- **${gap.topic.replaceAll("_", " ")}** — ${gap.question} — ${gap.reason.replaceAll("_", " ")}. Impact: ${gap.impact}`) : ["_No unresolved evidence gaps._"]), "",
  ];
}

function readSolutionRevision(body: string) {
  const match = body.match(/<!-- solution-revision:(\d+) -->\s*$/);
  return match ? Number(match[1]) : 0;
}

function compatibilityProjection(body: string, digest: string) {
  return `${body}\n<!-- canonical-design-digest:${digest} -->\n`;
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

function normalizeEvidence(value: string) { return value.replace(/\s+/g, " ").trim(); }

function isPrivateResearchHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = match.slice(1).map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a! >= 224;
}
