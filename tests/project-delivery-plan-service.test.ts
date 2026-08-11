import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ProjectDeliveryPlanService } from "../apps/core/src/project-delivery-plan-service.js";
import { LocalProjectRegistry } from "../apps/core/src/local-project-registry.js";
import { completeDeliveryPlan } from "./delivery-plan-fixture.js";

test("reviewed backlog publishes privately with digest evidence and a complete hierarchy", async () => {
  const root = join(process.cwd(), `.test-delivery-${crypto.randomUUID()}`);
  const workspace = join(root, "workspace");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(join(workspace, "README.md"), "# Product\n", "utf8");
    const projects = new LocalProjectRegistry(join(root, "state"));
    const project = await projects.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectDeliveryPlanService(projects);
    const plan = completeDeliveryPlan();
    const artifact = await service.publish(project.id, { ...plan, revision: 1, reviews: [{ schemaVersion: 1, reviewerId: "delivery-reviewer", discipline: "delivery", verdict: "pass", findings: [] }, { schemaVersion: 1, reviewerId: "technical-reviewer", discipline: "technical", verdict: "pass", findings: [] }] }, 10_000);
    assert.equal(artifact.kind, "backlog");
    assert.equal(artifact.qaPassed, true);
    const document = await service.read(project.id);
    assert.equal(document.digest, artifact.digest);
    assert.equal(document.itemCount, 4);
    assert.match(document.markdown, /## SUBTASK · Add workflow contract/);
    assert.match(document.markdown, /### Acceptance criteria/);
    assert.match(document.markdown, /### Definition of Done/);
    assert.match(document.markdown, /## Requirement coverage/);
    assert.match(document.markdown, /\*\*security\*\* → `plan_0000000000000004`/);
    assert.match(document.markdown, /## Delivery gates/);
    assert.match(document.markdown, /Capabilities: typescript implementation, independent validation/);
    assert.match(document.markdown, /### Rollback requirements/);
    assert.match(document.markdown, /## Independent QA/);
    const source = await service.readDraft(project.id);
    assert.equal(source.document.digest, document.digest);
    assert.equal(source.draft.items.length, 4);
    const path = join(workspace, "DELIVERY-PLAN.md");
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace("Verified delivery plan", "Tampered delivery plan"), "utf8");
    await assert.rejects(() => service.read(project.id), /changed outside its recorded revision/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("backlog publication rejects duplicate reviewers and skipped revisions", async () => {
  const root = join(process.cwd(), `.test-delivery-review-${crypto.randomUUID()}`);
  const workspace = join(root, "workspace");
  try {
    await mkdir(join(workspace, ".git"), { recursive: true });
    const projects = new LocalProjectRegistry(join(root, "state"));
    const project = await projects.register({ schemaVersion: 1, path: workspace });
    const service = new ProjectDeliveryPlanService(projects);
    const plan = completeDeliveryPlan();
    const duplicate = [{ schemaVersion: 1 as const, reviewerId: "same-reviewer", discipline: "delivery" as const, verdict: "pass" as const, findings: [] }, { schemaVersion: 1 as const, reviewerId: "same-reviewer", discipline: "technical" as const, verdict: "pass" as const, findings: [] }];
    await assert.rejects(() => service.publish(project.id, { ...plan, revision: 1, reviews: duplicate }), /independent/);
    const reviews = [{ ...duplicate[0]!, reviewerId: "delivery-reviewer" }, { ...duplicate[1]!, reviewerId: "technical-reviewer" }];
    await assert.rejects(() => service.publish(project.id, { ...plan, revision: 2, reviews }), /must be 1/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
