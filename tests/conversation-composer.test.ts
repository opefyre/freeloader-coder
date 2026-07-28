import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareComposerRequest,
  removeComposerAttachment,
  type ComposerAttachment
} from "../packages/conversation/src/index.js";
import { sha256 } from "../packages/conversation/src/sha256.js";

function attachment(
  overrides: Partial<ComposerAttachment> = {}
): ComposerAttachment {
  return {
    id: "attachment-1",
    kind: "file",
    label: "requirements.md",
    mediaType: "text/markdown",
    sizeBytes: 1_200,
    locator: "project file · docs/requirements.md",
    previewText: "Add a safe project timeline.",
    permission: "allowed",
    removed: false,
    ...overrides
  };
}

test("browser-safe SHA-256 matches the published empty-string and abc vectors", () => {
  assert.equal(
    sha256(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("accepted context is scoped, cited, digest-bound, and provider-ready", () => {
  const result = prepareComposerRequest({
    outcome: "Build a safe project timeline.",
    targetProjectId: "project-main",
    attachments: [
      attachment(),
      attachment({
        id: "attachment-image",
        kind: "image",
        label: "timeline.png",
        mediaType: "image/png",
        sizeBytes: 800_000,
        locator: "local selection · timeline.png"
      })
    ],
    implementationPreference: "Use existing project patterns."
  });
  assert.deepEqual(result.acceptedAttachmentIds, ["attachment-1", "attachment-image"]);
  assert.equal(result.citations.length, 2);
  assert.match(result.citations[0]!.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.providerPayload?.context.length, 2);
  assert.deepEqual(result.rejectedAttachmentIds, []);
});

test("removed and rejected content never reaches citations or provider payload", () => {
  const removed = removeComposerAttachment([
    attachment(),
    attachment({
      id: "attachment-sensitive",
      previewText: "access_token=synthetic-sensitive-material"
    })
  ], "attachment-1");
  const result = prepareComposerRequest({
    outcome: "Build a safe project timeline.",
    targetProjectId: "project-main",
    attachments: removed,
    implementationPreference: "Use existing patterns."
  });
  assert.deepEqual(result.removedAttachmentIds, ["attachment-1"]);
  assert.deepEqual(result.rejectedAttachmentIds, ["attachment-sensitive"]);
  assert.equal(result.providerPayload, null);
  assert.equal(JSON.stringify(result.citations).includes("attachment-sensitive"), false);
});

test("permission, size, type, insecure URL, and sensitive previews fail locally", () => {
  const failures = [
    attachment({ permission: "denied" }),
    attachment({ sizeBytes: 6_000_000 }),
    attachment({ kind: "image", mediaType: "image/svg+xml" }),
    attachment({ kind: "url", locator: "http://example.test/context" }),
    attachment({ previewText: "contact owner@example.test before changing it" })
  ];
  for (const [index, candidate] of failures.entries()) {
    const result = prepareComposerRequest({
      outcome: "Review this context.",
      targetProjectId: "project-main",
      attachments: [{ ...candidate, id: `failure-${index}` }],
      implementationPreference: "Review only."
    });
    assert.equal(result.providerPayload, null);
    assert.deepEqual(result.rejectedAttachmentIds, [`failure-${index}`]);
  }
});

test("blocking ambiguity asks focused questions while non-blocking ambiguity is editable", () => {
  const blocked = prepareComposerRequest({
    outcome: "Change the interface.",
    targetProjectId: null,
    attachments: [],
    conflictingInstructions: true
  });
  assert.equal(blocked.providerPayload, null);
  assert.deepEqual(
    blocked.findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.title),
    ["Which project should change?", "Which instruction should win?"]
  );

  const assumed = prepareComposerRequest({
    outcome: "Change the interface.",
    targetProjectId: "project-main",
    attachments: []
  });
  assert.equal(assumed.providerPayload?.assumptions.length, 1);
  assert.equal(
    assumed.findings.find((finding) => finding.severity === "assumption")?.editable,
    true
  );
});

test("an empty draft remains usable and cannot create provider work", () => {
  const result = prepareComposerRequest({
    outcome: "   ",
    targetProjectId: "project-main",
    attachments: []
  });
  assert.equal(result.providerPayload, null);
  assert.equal(result.outcome, "");
  assert.equal(
    result.findings.find((finding) => finding.id === "outcome-required")?.title,
    "What outcome do you want?"
  );
});
