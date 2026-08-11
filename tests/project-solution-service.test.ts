import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { ProjectArtifactStore } from "../apps/core/src/project-artifact-store.js";
import { ProjectSolutionService } from "../apps/core/src/project-solution-service.js";

const draft = {
  schemaVersion: 1 as const, revision: 1, title: "Team operations product", summary: "A complete local-first product for planning and coordinating team operations.",
  behavior: ["Owners create projects and approve material plans."], architecture: ["A local control plane coordinates durable project lifecycles."],
  userExperience: ["Build remains conversation-first with picker-based resources."], data: ["Project state is versioned, private, and restart-safe."],
  integrations: ["Jira and GitHub are selected per project from app-level connections."], security: ["Credentials remain in the operating-system vault."],
  privacy: ["Personal paths and secrets never enter browser responses."], reliability: ["Idempotent transitions and atomic writes preserve recoverability."],
  rollout: ["Ship behind an owner-only local MVP gate before wider use."], metrics: ["Measure verified completion, recovery, and owner interruption rates."],
  alternatives: [
    { option: "Use the restart-safe local control plane.", disposition: "selected" as const, rationale: "It preserves project isolation and owner control." },
    { option: "Use an ungoverned hosted-only worker.", disposition: "rejected" as const, rationale: "It breaks local ownership and evidence boundaries." },
  ],
  unresolvedBlockers: [{ blocker: "Confirm the first production deployment target.", impact: "Deployment automation remains disabled.", owner: "Owner", resolution: "Select an approved free-tier target during delivery planning." }],
  citations: ["local://CONTEXT.md", "local://RESEARCH.md", "https://example.com/product"],
  reviews: [{ reviewerId: "product-reviewer", discipline: "product" as const, verdict: "pass" as const, findings: ["Product scope is coherent."] }, { reviewerId: "technical-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: ["Architecture boundaries are implementable."] }],
};

function researchGraph(discipline: "product" | "technical", overrides: Record<string, unknown> = {}) {
  const sourceId = `${discipline}-source`;
  const excerpt = `Verified ${discipline} source evidence for the proposed solution.`;
  const topics = discipline === "product" ? ["market", "competitor_features", "competitor_pricing", "public_reviews", "audience", "problem", "product"] as const : ["architecture", "data", "integrations", "security", "privacy", "reliability", "delivery"] as const;
  return {
    schemaVersion: 1 as const,
    discipline,
    questions: [`What evidence constrains the ${discipline} solution?`],
    sources: [{ sourceId, url: `https://example.com/${discipline}`, title: `${discipline} primary source`, retrievedAt: "2026-08-11T12:00:00.000Z", excerpt, excerptDigest: createHash("sha256").update(excerpt).digest("hex"), confidence: 0.9, relevance: 0.95, freshness: "current" as const }],
    claims: topics.map((topic) => ({ claimId: `${discipline}-${topic}`, topic, statement: `Verified ${topic.replaceAll("_", " ")} evidence constrains the proposed solution.`, sourceIds: [sourceId], confidence: 0.9, relevance: 0.95 })),
    contradictions: [], gaps: [], ...overrides,
  };
}

test("solution publication is complete, cited, independently reviewed, atomic, and revisioned", async () => {
  const root = join(process.cwd(), `.test-solution-${crypto.randomUUID()}`);
  const workspace = join(root, "product");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(join(workspace, "README.md"), "# Product\n", "utf8");
    const registry = new LocalProjectRegistry(join(root, "state"));
    const project = await registry.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectSolutionService(registry, undefined, async (url) => new Response(`Page body with ${url.toString().includes("product") ? researchGraph("product").sources[0]!.excerpt : researchGraph("technical").sources[0]!.excerpt}`, { status: 200, headers: { "content-type": "text/html" } }));
    const research = await service.publishResearch(project.id, {
      contextDigest: "a".repeat(64),
      product: { providerId: "provider-a", modelId: "product-model", response: researchGraph("product") },
      technical: { providerId: "provider-b", modelId: "technical-model", response: researchGraph("technical", { sources: [{ ...researchGraph("technical").sources[0], freshness: "stale" }], gaps: [{ topic: "architecture", question: "Is a newer technical source available?", reason: "browsing_unavailable", impact: "The claim remains usable but must be refreshed before a consequential decision." }] }) },
    });
    const researchContent = await readFile(join(workspace, "RESEARCH.md"), "utf8");
    assert.match(researchContent, /Product, market, and user analysis/);
    assert.match(researchContent, /provider-a/);
    assert.match(researchContent, /specialist evidence, not an approved product/);
    assert.match(researchContent, /retrieved 2026-08-11T12:00:00.000Z/);
    assert.equal(researchContent.includes("excerpt `" + researchGraph("product").sources[0]!.excerptDigest + "`"), true);
    assert.match(researchContent, /browsing unavailable/);
    assert.match(researchContent, /stale/);
    assert.match(researchContent, new RegExp(research.metadata.bodyDigest));
    const first = await service.publish(project.id, draft, 10);
    const content = await readFile(join(workspace, "DESIGN.md"), "utf8");
    for (const heading of ["Product behavior", "Architecture", "User experience", "Data", "Integrations", "Security", "Privacy", "Reliability", "Rollout", "Success metrics", "Sources", "Independent review"]) assert.match(content, new RegExp(`## ${heading}`));
    assert.match(content, /solution-revision:1/);
    assert.match(content, /codkesh-artifact/);
    const product = await readFile(join(workspace, "PRODUCT.md"), "utf8");
    assert.match(product, /## Product behavior/);
    assert.match(product, /## Success metrics/);
    assert.match(product, /## Alternatives and decisions/);
    assert.match(product, /## Unresolved blockers/);
    assert.match(product, new RegExp(research.metadata.bodyDigest));
    assert.match(content, /Use an ungoverned hosted-only worker/);
    assert.match(content, /Confirm the first production deployment target/);
    const compatibility = await readFile(join(workspace, ".pipeline", "SOLUTION.md"), "utf8");
    assert.match(compatibility, new RegExp(`canonical-design-digest:${first.digest}`));
    assert.deepEqual(first.reviewerIds, ["product-reviewer", "technical-reviewer"]);
    await assert.rejects(() => service.publish(project.id, draft), /revision must be 2/);
    const second = await service.publish(project.id, { ...draft, revision: 2, summary: `${draft.summary} The revision includes owner feedback.` }, 20);
    assert.equal(second.revision, 2);
    const history = await service.history(project.id);
    assert.deepEqual(history.map((item) => item.revision), [2, 1]);
    assert.equal(history[0]?.digest, second.digest);
    assert.equal(history[1]?.digest, first.digest);
    const decision = { schemaVersion: 1 as const, expectedRevision: 8, artifactDigest: second.digest, decision: "approved" as const, feedback: null };
    const approved = await service.recordDecision(project.id, decision, "owner-approval-0001", 30);
    assert.equal(approved.design.metadata.approvedDigest, second.digest);
    assert.equal(approved.product.metadata.approvedDigest, approved.product.metadata.bodyDigest);
    assert.match(approved.decisions.body, /Solution \*\*approved\*\*/);
    assert.match(approved.status.body, /Generate and independently validate the delivery plan/);
    assert.deepEqual((await service.history(project.id)).map((item) => item.revision), [2, 1]);
    const beforeReplayRevision = approved.decisions.metadata.revision;
    const replay = await service.recordDecision(project.id, decision, "owner-approval-0001", 40);
    assert.equal(replay.decisions.metadata.revision, beforeReplayRevision);
    assert.equal((await new ProjectArtifactStore().read(workspace, "design")).metadata.approvedDigest, second.digest);
    const secondContent = await readFile(join(workspace, "DESIGN.md"), "utf8");
    await writeFile(join(workspace, "DESIGN.md"), secondContent.replace("owner feedback", "unverified mutation"), { encoding: "utf8", mode: 0o600 });
    await assert.rejects(() => service.read(project.id), /changed outside its recorded revision/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("research publication rejects invented citations and preserves contradictions and browsing gaps", async () => {
  const root = join(process.cwd(), `.test-research-contract-${crypto.randomUUID()}`);
  const workspace = join(root, "product");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(join(workspace, "README.md"), "# Product\n", "utf8");
    const registry = new LocalProjectRegistry(join(root, "state"));
    const project = await registry.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectSolutionService(registry, undefined, async (url) => new Response(`Page body with ${url.toString().includes("product") ? researchGraph("product").sources[0]!.excerpt : researchGraph("technical").sources[0]!.excerpt}`, { status: 200, headers: { "content-type": "text/plain" } }));
    await assert.rejects(() => service.publishResearch(project.id, {
      contextDigest: "a".repeat(64),
      product: { providerId: "provider-a", modelId: "product-model", response: researchGraph("product", { claims: [{ ...researchGraph("product").claims[0], sourceIds: ["invented-source"] }] }) },
      technical: { providerId: "provider-b", modelId: "technical-model", response: researchGraph("technical") },
    }), /unknown source/);
    await assert.rejects(() => service.publishResearch(project.id, {
      contextDigest: "a".repeat(64),
      product: { providerId: "provider-a", modelId: "product-model", response: researchGraph("product", { sources: [{ ...researchGraph("product").sources[0], url: "http://127.0.0.1/private" }] }) },
      technical: { providerId: "provider-b", modelId: "technical-model", response: researchGraph("technical") },
    }), /private or loopback/);
    await assert.rejects(() => service.publishResearch(project.id, {
      contextDigest: "a".repeat(64),
      product: { providerId: "provider-a", modelId: "product-model", response: researchGraph("product", { sources: [{ ...researchGraph("product").sources[0], excerptDigest: "e".repeat(64) }] }) },
      technical: { providerId: "provider-b", modelId: "technical-model", response: researchGraph("technical") },
    }), /digest does not match/);
    const product = researchGraph("product", {
      claims: [
        ...researchGraph("product").claims,
        { claimId: "product-opposing", topic: "product", statement: "A second verified source materially contradicts the primary product claim.", sourceIds: ["product-source"], confidence: 0.7, relevance: 0.8 },
      ],
      contradictions: [{ claimIds: ["product-product", "product-opposing"], summary: "Verified sources disagree about the preferred owner workflow." }],
    });
    await service.publishResearch(project.id, {
      contextDigest: "a".repeat(64),
      product: { providerId: "provider-a", modelId: "product-model", response: product },
      technical: { providerId: "provider-b", modelId: "technical-model", response: { ...researchGraph("technical"), sources: [], claims: [], gaps: ["architecture", "data", "integrations", "security", "privacy", "reliability", "delivery"].map((topic) => ({ topic, question: `What ${topic} evidence is available?`, reason: "browsing_unavailable", impact: "The topic remains explicitly unresolved." })) } },
    });
    const markdown = await readFile(join(workspace, "RESEARCH.md"), "utf8");
    assert.match(markdown, /Verified sources disagree/);
    assert.match(markdown, /What architecture evidence is available/);
    assert.match(markdown, /No verified claims/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("solution publication fails closed without independent passing reviews", async () => {
  const root = join(process.cwd(), `.test-solution-invalid-${crypto.randomUUID()}`);
  const workspace = join(root, "product");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(join(workspace, "README.md"), "# Product\n", "utf8");
    const registry = new LocalProjectRegistry(join(root, "state"));
    const project = await registry.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectSolutionService(registry);
    await assert.rejects(() => service.publish(project.id, { ...draft, reviews: [draft.reviews[0], { ...draft.reviews[1], reviewerId: "product-reviewer" }] }), /independent product and technical reviews/);
    await assert.rejects(() => readFile(join(workspace, ".pipeline", "SOLUTION.md"), "utf8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("revision and decline decisions are durable, idempotent, and do not approve artifacts", async () => {
  for (const decision of ["revision_requested", "declined"] as const) {
    const root = join(process.cwd(), `.test-solution-${decision}-${crypto.randomUUID()}`);
    const workspace = join(root, "product");
    try {
      await mkdir(join(workspace, ".git"), { recursive: true });
      await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
      await writeFile(join(workspace, "README.md"), "# Product\n", "utf8");
      const registry = new LocalProjectRegistry(join(root, "state"));
      const project = await registry.register({ schemaVersion: 1, path: workspace });
      const service = new ProjectSolutionService(registry);
      await seedResearch(workspace);
      const solution = await service.publish(project.id, draft, 10);
      const request = {
        schemaVersion: 1 as const,
        expectedRevision: 4,
        artifactDigest: solution.digest,
        decision,
        feedback: decision === "revision_requested" ? "Clarify the migration and rollback boundaries." : null,
      };
      const first = await service.recordDecision(project.id, request, `owner-${decision}-0001`, 20);
      const replay = await service.recordDecision(project.id, request, `owner-${decision}-0001`, 30);
      assert.equal(first.design.metadata.approvedDigest, null);
      assert.equal(replay.decisions.metadata.revision, first.decisions.metadata.revision);
      assert.match(first.decisions.body, new RegExp(decision.replaceAll("_", " ")));
      assert.match(first.status.body, decision === "revision_requested" ? /Solution revision is pending/ : /No further work is authorized/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

async function seedResearch(workspace: string) {
  const store = new ProjectArtifactStore();
  await store.initialize(workspace);
  const current = await store.read(workspace, "research");
  await store.write(workspace, {
    kind: "research",
    body: "# Research\n\n## Questions\n\n- What evidence constrains the solution?\n\n## Evidence\n\n- Verified source: https://example.com/product\n\n## Findings\n\n- Evidence is available for solution synthesis.\n\n## Contradictions and gaps\n\n- No unresolved contradiction was observed.",
    producer: "test:research",
    expectedDigest: current.metadata.bodyDigest,
  });
}
