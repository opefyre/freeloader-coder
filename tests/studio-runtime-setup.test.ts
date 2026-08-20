import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  repairActions,
  runtimeChecks,
  runtimeServices,
  runtimeSetupStages,
  sandboxChoices,
} from "../apps/studio/src/runtime-setup-fixture.js";

test("runtime setup remains internal and is absent from primary Settings", async () => {
  const app = await readFile("apps/studio/src/App.tsx", "utf8");
  const panel = await readFile(
    "apps/studio/src/components/runtime/runtime-setup-panel.tsx",
    "utf8"
  );
  assert.doesNotMatch(app, /TabsTrigger value="advanced"/);
  assert.doesNotMatch(app, />Advanced<\/TabsTrigger>/);
  assert.match(panel, /Clone-to-running setup/);
  assert.deepEqual(
    runtimeSetupStages.map((stage) => stage.id),
    ["repository", "preflight", "core", "sandbox", "ready"]
  );
});

test("preflight distinguishes required and optional requirements", () => {
  assert.equal(runtimeChecks.some((item) => item.required), true);
  assert.equal(
    runtimeChecks.find((item) => item.id === "local-model-runtime")?.required,
    false
  );
  assert.equal(
    runtimeChecks.find((item) => item.id === "port")?.value.startsWith("127.0.0.1"),
    true
  );
});

test("UI never equates reduced native isolation with strong containers", async () => {
  const native = sandboxChoices.find((choice) => choice.id === "native")!;
  const container = sandboxChoices.find((choice) => choice.id === "container")!;
  assert.equal(native.strength, "Reduced isolation");
  assert.equal(container.strength, "Strong isolation");
  assert.match(native.description, /without Docker/);
  const panel = await readFile(
    "apps/studio/src/components/runtime/runtime-setup-panel.tsx",
    "utf8"
  );
  assert.match(panel, /Continue without Docker/);
  assert.match(panel, /Container isolation is not required for this project/);
});

test("runtime service and repair UI preserves canonical safety promises", async () => {
  assert.deepEqual(
    runtimeServices.map((service) => service.id),
    ["core", "worker", "validator", "preview"]
  );
  assert.equal(repairActions.length, 4);
  const panel = await readFile(
    "apps/studio/src/components/runtime/runtime-setup-panel.tsx",
    "utf8"
  );
  assert.match(panel, /Exactly one controller owns this profile/);
  assert.match(panel, /Projects, credentials, and checkpoints were preserved/);
  assert.match(panel, /will not be duplicated/);
});

test("missing container dependency offers instructions, verification, and Resume", async () => {
  const panel = await readFile(
    "apps/studio/src/components/runtime/runtime-setup-panel.tsx",
    "utf8"
  );
  assert.match(panel, /Docker instructions/);
  assert.match(panel, /Podman instructions/);
  assert.match(panel, /Resume verification/);
  assert.match(panel, /will not be installed automatically/);
});
