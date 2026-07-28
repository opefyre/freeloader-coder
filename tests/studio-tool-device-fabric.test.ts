import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("integrations mounts the interactive tool and device fabric", async () => {
  const integrations = await readFile(
    "apps/studio/src/components/integrations/integration-workbench.tsx",
    "utf8"
  );
  const fabric = await readFile(
    "apps/studio/src/components/integrations/tool-device-fabric.tsx",
    "utf8"
  );
  assert.match(integrations, /<ToolDeviceFabric \/>/);
  for (const copy of [
    "Tool & device fabric",
    "Permissioned catalogue",
    "Constrained MCP lifecycle",
    "Private device mesh",
    "Capability-aware work routing"
  ]) {
    assert.match(fabric, new RegExp(copy));
  }
});

test("fabric controls expose honest demo scope, sources, and interactive states", async () => {
  const source = await readFile(
    "apps/studio/src/components/integrations/tool-device-fabric.tsx",
    "utf8"
  );
  assert.match(source, /Interactive contract demo/);
  assert.match(source, /PIPE-80–87/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-selected=\{view === id\}/);
  assert.match(source, /aria-pressed=\{workerMode === mode\}/);
  assert.match(source, /setMcpState/);
  assert.match(source, /setPairing/);
  assert.match(source, /setWorkerMode/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noreferrer"/);
});

test("fabric derives routing from the deterministic distributed scheduler", async () => {
  const fixture = await readFile("apps/studio/src/tool-device-fixture.ts", "utf8");
  assert.match(fixture, /scheduleTask/);
  assert.match(fixture, /preferRemoteCompute: true/);
  assert.match(fixture, /privacy: "controller_only"/);
  assert.match(fixture, /sourceDeviceId/);
  assert.match(fixture, /thermal/);
  assert.match(fixture, /sleeping/);
});
