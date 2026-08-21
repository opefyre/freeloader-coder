import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the unified launcher owns and terminates complete service process groups", async () => {
  const source = await readFile("scripts/start-agent-canvas.mjs", "utf8");
  const supervisor = await readFile("scripts/service-supervisor.mjs", "utf8");
  assert.match(source, /detached: process\.platform !== "win32"/);
  assert.match(source, /scripts", "service-supervisor\.mjs"/);
  assert.match(source, /CODKESH_LAUNCHER_PID: String\(process\.pid\)/);
  assert.match(source, /process\.kill\(-child\.pid, name\)/);
  assert.match(source, /descendantPids\(child\.pid\)\.reverse\(\)/);
  assert.match(source, /execFileSync\("ps", \["-axo", "pid=,ppid="\]/);
  assert.match(source, /for \(const \{ child \} of services\) signal\(child, "SIGTERM"\)/);
  assert.match(source, /for \(const \{ child \} of services\) signal\(child, "SIGKILL"\)/);
  assert.match(supervisor, /if \(!isAlive\(launcherPid\) \|\| process\.ppid === 1\) stop\(0, "launcher stopped"\)/);
  assert.match(supervisor, /for \(const pid of descendantPids\(rootPid\)\.reverse\(\)\)/);
  assert.match(supervisor, /signalTree\(child\.pid, "SIGTERM"\)/);
  assert.match(supervisor, /signalTree\(child\.pid, "SIGKILL"\)/);
});
