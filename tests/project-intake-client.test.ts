import assert from "node:assert/strict";
import test from "node:test";
import { createProjectIntake, decodeProjectIntakeReference, encodeProjectIntakeReference, listProjectIntakes, saveProjectIntakeDraft, saveResumableProjectIntakeDraft, submitProjectIntake } from "../apps/studio/src/project-intake-client.js";

const intake = { schemaVersion: 1 as const, id: "intake_0123456789abcdef0123", projectMode: "new_product" as const, state: "draft" as const, idea: "", workspaceReference: null, workspaceLabel: null, attachmentReferences: [], selectedResources: [], revision: 1, createdAt: 1, updatedAt: 1, submittedAt: null, cancellationReason: null };

test("project intake client uses only loopback, opaque contracts, and idempotent submit", async () => {
  assert.equal((await listProjectIntakes("http://127.0.0.1:4312", async () => Response.json({ schemaVersion: 1, intakes: [intake] }))).intakes.length, 1);
  let requestUrl = ""; let requestBody = ""; let key = "";
  await createProjectIntake("http://127.0.0.1:4312", "new_product", "intake:create:01234567", async (url, init) => { requestUrl = String(url); key = new Headers(init?.headers).get("Idempotency-Key") ?? ""; return Response.json(intake); });
  assert.match(requestUrl, /\/api\/v1\/project-intakes$/); assert.equal(key, "intake:create:01234567");
  await saveProjectIntakeDraft("http://127.0.0.1:4312", intake.id, { schemaVersion: 1, expectedRevision: 1, idea: "Build it", workspaceReference: "workspace:opaque_12345678", attachmentReferences: [] }, async (_url, init) => { requestBody = String(init?.body); return Response.json({ ...intake, state: "resource_selection", revision: 2, idea: "Build it", workspaceReference: "workspace:opaque_12345678" }); });
  assert.equal(requestBody.includes("/Users/"), false);
  await submitProjectIntake("http://127.0.0.1:4312", intake.id, 2, "intake:submit:01234567", async (_url, init) => { key = new Headers(init?.headers).get("Idempotency-Key") ?? ""; return Response.json({ ...intake, state: "submitted", revision: 3, submittedAt: 2 }); });
  assert.equal(key, "intake:submit:01234567");
  await assert.rejects(() => listProjectIntakes("https://remote.example", async () => Response.json({ schemaVersion: 1, intakes: [] })), /loopback/);
  await assert.rejects(() => listProjectIntakes("http://127.0.0.1:4312", async () => Response.json({ schemaVersion: 1, intakes: [{ ...intake, workspaceReference: "file:///Users/private" }] })), /Invalid|expected|format/i);
});

test("project intake references round-trip without exposing their source value", () => {
  const source = "/Users/example/private product";
  const reference = encodeProjectIntakeReference("workspace", source);
  assert.equal(reference.includes(source), false);
  assert.equal(decodeProjectIntakeReference(reference, "workspace"), source);
  assert.equal(decodeProjectIntakeReference(reference, "project"), null);
});

test("resumable intake autosave skips an unchanged durable draft", async () => {
  let requests = 0;
  const current = { ...intake, state: "resource_selection" as const, idea: "Keep this draft", workspaceReference: "project:cHJvamVjdF8xMjM0NTY3OA", workspaceLabel: "Project", revision: 4 };
  const saved = await saveResumableProjectIntakeDraft("http://127.0.0.1:4312", current, {
    mode: "new_product", idea: "Keep this draft", workspaceReference: current.workspaceReference,
    workspaceLabel: "Project", attachments: [], idempotencyKey: "intake:draft:stable",
  }, async () => { requests += 1; return Response.json(current); });
  assert.equal(requests, 0);
  assert.equal(saved.revision, 4);
});
