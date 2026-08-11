import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ProjectSolutionOrchestrator,
  SolutionReviewDissentError,
  type RoutedSolutionModel,
  type SolutionRole,
} from "../apps/core/src/project-solution-orchestrator.js";

const content = {
  schemaVersion: 1 as const,
  title: "Autonomous product delivery",
  summary: "A grounded and owner-governed product delivery workflow with durable evidence and safe execution.",
  behavior: ["Owners describe a major outcome and approve the reviewed solution."],
  architecture: ["A restart-safe local control plane coordinates provider-backed stages."],
  userExperience: ["The owner uses a minimal conversation, action center, and analytics surface."],
  data: ["Versioned project artifacts remain in the selected local project folder."],
  integrations: ["Project resources reference app-level connections without copying credentials."],
  security: ["Credentials remain in the operating-system credential vault."],
  privacy: ["Secrets and personal data are excluded from provider prompts."],
  reliability: ["Every state transition is digest-bound and idempotent."],
  rollout: ["The owner-only MVP is validated before public release."],
  metrics: ["Track verified completion, recovery, and owner interruption rates."],
  citations: ["local://CONTEXT.md"],
};
const permit = { schemaVersion: 1 as const, projectId: "project_abcdef0123456789", contextDigest: "a".repeat(64), dataClass: "source_code" as const, providerIds: ["test"], approvedAt: 1, expiresAt: 9_999_999_999_999 };

function researchEvidence(role: SolutionRole) {
  const discipline = role === "product_research" ? "product" as const : "technical" as const;
  const excerpt = `Verified ${discipline} source evidence for this solution.`;
  const topics = discipline === "product" ? ["market", "competitor_features", "competitor_pricing", "public_reviews", "audience", "problem", "product"] as const : ["architecture", "data", "integrations", "security", "privacy", "reliability", "delivery"] as const;
  return { schemaVersion: 1 as const, discipline, questions: [`What constrains ${discipline}?`], sources: [{ sourceId: `${discipline}-source`, url: `https://example.com/${discipline}`, title: `${discipline} source`, retrievedAt: "2026-08-11T12:00:00.000Z", excerpt, excerptDigest: createHash("sha256").update(excerpt).digest("hex"), confidence: 0.9, relevance: 0.9, freshness: "current" as const }], claims: topics.map((topic) => ({ claimId: `${discipline}-${topic}`, topic, statement: `Verified evidence constrains the ${topic.replaceAll("_", " ")} solution.`, sourceIds: [`${discipline}-source`], confidence: 0.9, relevance: 0.9 })), contradictions: [], gaps: [] };
}

test("solution orchestration uses parallel specialists and independent reviewers before publication", async () => {
  const roles: SolutionRole[] = [];
  const published: unknown[] = [];
  const research: unknown[] = [];
  const lifecycle = { projectId: "project_abcdef0123456789", stage: "solution_design", artifacts: [], designFeedback: [{ artifactDigest: "c".repeat(64), feedback: "Keep owner actions simple.", requestedAt: 1 }] };
  const model: RoutedSolutionModel = {
    async run(input) {
      roles.push(input.role);
      assert.equal(input.contextDigest, "a".repeat(64));
      assert.ok(input.sources.some((source) => source.name === "CONTEXT.md"));
      if (input.role === "solution_reconciliation") return evidence("reconciler", content);
      if (input.role === "product_review") return evidence("product-model", { schemaVersion: 1, reviewerId: "review-a", discipline: "product", verdict: "pass", findings: ["Product scope is coherent."] });
      if (input.role === "technical_review") return evidence("technical-model", { schemaVersion: 1, reviewerId: "review-b", discipline: "technical", verdict: "pass", findings: ["Architecture is implementable."] });
      return evidence(input.role, researchEvidence(input.role));
    },
  };
  const service = new ProjectSolutionOrchestrator(
    { get: async () => lifecycle as any, publishSolution: async (_id, artifact) => ({ ...lifecycle, stage: "awaiting_design_approval", artifacts: [artifact] }) as any },
    { publishResearch: async (_id: string, evidence: unknown) => { research.push(evidence); }, publish: async (_id: string, draft: unknown) => { published.push(draft); return { kind: "solution", digest: "b".repeat(64), revision: 1 }; }, read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } } as any,
    { readVerified: async () => ({ digest: "a".repeat(64), markdown: "# Context\n\nGrounded evidence." }) },
    { authorize: async () => permit },
    model,
    () => 42
  );
  const result = await service.run(lifecycle.projectId);
  assert.equal(result.stage, "awaiting_design_approval");
  assert.deepEqual(new Set(roles.slice(0, 2)), new Set(["product_research", "technical_research"]));
  assert.deepEqual(roles.slice(2), ["solution_reconciliation", "product_review", "technical_review"]);
  assert.equal(published.length, 1);
  assert.equal(research.length, 1);
  const draft = published[0] as any;
  assert.equal(draft.revision, 1);
  assert.match(draft.reviews[0].reviewerId, /^test\/product-model\/review-a$/);
  assert.match(draft.reviews[1].reviewerId, /^test\/technical-model\/review-b$/);
});

test("review dissent fails closed without publishing", async () => {
  let published = false;
  const lifecycle = { projectId: "project_abcdef0123456789", stage: "solution_design", artifacts: [], designFeedback: [] };
  const service = new ProjectSolutionOrchestrator(
    { get: async () => lifecycle as any, publishSolution: async () => { throw new Error("must not publish"); } },
    { publishResearch: async () => undefined, publish: async () => { published = true; throw new Error("must not publish"); }, read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } } as any,
    { readVerified: async () => ({ digest: "a".repeat(64), markdown: "# Context\n\nGrounded evidence." }) },
    { authorize: async () => permit },
    { run: async ({ role }) => role === "solution_reconciliation" ? evidence("reconciler", content) : role === "product_review" ? evidence("review-a", { schemaVersion: 1, reviewerId: "a-reviewer", discipline: "product", verdict: "fail", findings: ["User workflow is incomplete."] }) : role === "technical_review" ? evidence("review-b", { schemaVersion: 1, reviewerId: "b-reviewer", discipline: "technical", verdict: "pass", findings: [] }) : evidence(role, researchEvidence(role)) },
  );
  await assert.rejects(() => service.run(lifecycle.projectId), SolutionReviewDissentError);
  assert.equal(published, false);
});

test("malformed reconciler output fails before review and publication", async () => {
  let published = false;
  const lifecycle = { projectId: "project_abcdef0123456789", stage: "solution_design", artifacts: [], designFeedback: [] };
  const service = new ProjectSolutionOrchestrator(
    { get: async () => lifecycle as any, publishSolution: async () => { throw new Error("must not publish"); } },
    { publishResearch: async () => undefined, publish: async () => { published = true; throw new Error("must not publish"); }, read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } } as any,
    { readVerified: async () => ({ digest: "a".repeat(64), markdown: "# Context\n\nGrounded evidence." }) },
    { authorize: async () => permit },
    { run: async ({ role }) => evidence(role, role === "solution_reconciliation" ? { summary: "incomplete" } : researchEvidence(role)) },
  );
  await assert.rejects(() => service.run(lifecycle.projectId));
  assert.equal(published, false);
});

test("owner revision feedback changes only explicitly scoped solution sections", async () => {
  const lifecycle = { projectId: "project_abcdef0123456789", stage: "solution_design", artifacts: [{ kind: "solution", digest: "b".repeat(64) }], designFeedback: [{ artifactDigest: "b".repeat(64), feedback: "Change only the architecture boundary.", requestedAt: 2 }] };
  const current = { ...content, behavior: ["Preserve this product behavior."], architecture: ["Preserve the old architecture."] };
  let published: any;
  const service = new ProjectSolutionOrchestrator(
    { get: async () => lifecycle as any, publishSolution: async (_id, artifact) => ({ ...lifecycle, stage: "awaiting_design_approval", artifacts: [artifact] }) as any },
    {
      read: async () => ({ digest: "b".repeat(64), revision: 1 }),
      readContent: async () => current,
      publishResearch: async () => undefined,
      publish: async (_id: string, draft: unknown) => { published = draft; return { kind: "solution", digest: "c".repeat(64), revision: 2 }; },
    } as any,
    { readVerified: async () => ({ digest: "a".repeat(64), markdown: "# Context\n\nGrounded evidence." }) },
    { authorize: async () => permit },
    { run: async ({ role }) => {
      if (role === "solution_revision_scope") return evidence("scope", { schemaVersion: 1, sections: ["architecture"], rationale: "Only architecture was requested." });
      if (role === "solution_reconciliation") return evidence("reconciler", { ...content, behavior: ["Unrequested behavior change."], architecture: ["Use the revised architecture boundary."] });
      if (role === "product_review") return evidence("product", { schemaVersion: 1, reviewerId: "product-reviewer", discipline: "product", verdict: "pass", findings: [] });
      if (role === "technical_review") return evidence("technical", { schemaVersion: 1, reviewerId: "technical-reviewer", discipline: "technical", verdict: "pass", findings: [] });
      return evidence(role, researchEvidence(role));
    } },
  );
  await service.run(lifecycle.projectId);
  assert.deepEqual(published.behavior, current.behavior);
  assert.deepEqual(published.architecture, ["Use the revised architecture boundary."]);
  assert.equal(published.revision, 2);
});

function evidence(modelId: string, response: unknown) {
  return { providerId: "test", modelId, response };
}
