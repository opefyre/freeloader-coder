import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("documented setup command is runnable, private, and idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-studio-setup-"));
  const run = () =>
    spawnSync(process.execPath, ["scripts/setup.mjs", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        PIPELINE_STUDIO_STATE_DIR: directory,
      },
    });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const firstState = JSON.parse(first.stdout) as {
    credentialStore: string;
    configuration: Record<string, string>;
    status: string;
  };
  assert.equal(firstState.status, "ready");
  assert.equal(firstState.credentialStore, "operating_system");
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  const statePath = join(directory, "setup-state.json");
  const stored = await readFile(statePath, "utf8");
  assert.doesNotMatch(stored, /api[_-]?key|password|bearer|sk-/i);
  if (process.platform !== "win32") {
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  }
});

test("repair command explicitly preserves projects, credentials, and checkpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-studio-repair-"));
  const result = spawnSync(
    process.execPath,
    ["scripts/setup.mjs", "--repair", "--json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        PIPELINE_STUDIO_STATE_DIR: directory,
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout) as {
    repair: { result: string; preserved: string[] };
  };
  assert.equal(state.repair.result, "safe_to_apply");
  assert.deepEqual(state.repair.preserved, [
    "projects",
    "credentials",
    "checkpoints",
  ]);
});

