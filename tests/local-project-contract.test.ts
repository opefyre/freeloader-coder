import assert from "node:assert/strict";
import test from "node:test";

import {
  localProjectCollectionSchema,
  localProjectRegistrationSchema,
  localProjectSnapshotSchema,
  validateLocalProjectCollection,
} from "../packages/runtime/src/local-projects.js";

const snapshot = {
  schemaVersion: 1,
  id: "project_0123456789abcdef",
  displayName: "Sample",
  state: "warning",
  observedAt: 10_000,
  validForMs: 60_000,
  facts: [{ label: "Repository", value: "Git observed", evidence: ".git directory" }],
  inferences: ["This appears to include TypeScript code."],
  decisions: ["Confirm the project."],
  warnings: ["Working-tree cleanliness was not evaluated."],
} as const;

test("local project contracts expose bounded observations without local paths", () => {
  assert.deepEqual(localProjectSnapshotSchema.parse(snapshot), snapshot);
  assert.deepEqual(
    localProjectRegistrationSchema.parse({
      schemaVersion: 1,
      path: "/Users/example/Projects/sample",
    }),
    { schemaVersion: 1, path: "/Users/example/Projects/sample" }
  );
  const collection = validateLocalProjectCollection({
    schemaVersion: 1,
    provenance: "local_observation",
    observedAt: 10_001,
    projects: [snapshot],
  });
  assert.equal(JSON.stringify(collection).includes("/Users/"), false);
});

test("unknown fields, duplicate identities, and path-shaped public fields fail closed", () => {
  assert.throws(() => localProjectSnapshotSchema.parse({ ...snapshot, canonicalPath: "/tmp/x" }));
  assert.throws(() =>
    validateLocalProjectCollection({
      schemaVersion: 1,
      provenance: "local_observation",
      observedAt: 10_001,
      projects: [snapshot, snapshot],
    })
  );
  assert.throws(() =>
    localProjectCollectionSchema.parse({
      schemaVersion: 1,
      provenance: "local_observation",
      observedAt: 10_001,
      projects: [{ ...snapshot, id: "project_invalid" }],
    })
  );
});
