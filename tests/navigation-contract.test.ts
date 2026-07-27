import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkspaceHref,
  navigationDestinations,
  parseWorkspaceHref,
  workspaceNavigationFor,
  workspaceSurfaces,
  type WorkspaceLocation
} from "../packages/ui/src/index.js";

test("safe workspace deep links round-trip every surface without private context", () => {
  for (const surface of workspaceSurfaces) {
    const resourceRequired = !["control", "help"].includes(surface);
    const location: WorkspaceLocation = {
      projectId: "demo-project",
      surface,
      density: "advanced",
      panel: "evidence",
      ...(resourceRequired ? { resourceId: "item-42" } : {})
    };
    const href = buildWorkspaceHref(location);
    assert.deepEqual(parseWorkspaceHref(href), location);
    assert.doesNotMatch(href, /token|secret|Users|exec|command/i);
  }
});

test("deep links reject external, malformed, executable, and secret-shaped context", () => {
  assert.throws(
    () => parseWorkspaceHref("https://example.com/workspace/demo/control"),
    /local paths/
  );
  assert.throws(
    () => parseWorkspaceHref("/workspace/demo/control?token=private"),
    /Unsupported link field/
  );
  assert.throws(
    () => parseWorkspaceHref("/workspace/demo/control/run-command"),
    /cannot address a resource/
  );
  assert.throws(
    () => parseWorkspaceHref("/workspace/demo/tasks/%2E%2E"),
    /shape is invalid|requires a resource|unsafe/
  );
  assert.throws(
    () => parseWorkspaceHref("/workspace/demo/tasks/item?panel=technical"),
    /Advanced density/
  );
});

test("Guided navigation exposes current work, decisions, preview, restore, and help", () => {
  const model = workspaceNavigationFor("needs_you", "guided");
  const labels = new Set(model.destinations.map((destination) => destination.label));
  assert.equal(model.highlighted, "decisions");
  assert.equal(model.technicalDetailsVisible, false);
  for (const label of ["Current work", "Needs you", "Preview", "Restore", "Help"]) {
    assert.equal(labels.has(label), true, `${label} should be directly discoverable`);
  }
});

test("all required navigation situations lead with one clear destination", () => {
  const expected = {
    first_run: "conversation",
    empty: "conversation",
    busy: "tasks",
    interrupted: "restore",
    needs_you: "decisions",
    multi_project: "control"
  } as const;
  for (const [situation, highlighted] of Object.entries(expected)) {
    const model = workspaceNavigationFor(
      situation as keyof typeof expected,
      "advanced"
    );
    assert.equal(model.highlighted, highlighted);
    assert.equal(model.technicalDetailsVisible, true);
    assert.ok(model.notice.length > 20);
  }
  assert.equal(navigationDestinations.length, 8);
});
