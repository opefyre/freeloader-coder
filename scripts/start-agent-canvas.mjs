import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const canvasRoot = resolve(root, "engine");
const stateDir = resolve(root, ".pipeline-studio", "agent-canvas-state");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const vite = resolve(root, "node_modules", "vite", "bin", "vite.js");
const supervisor = resolve(root, "scripts", "service-supervisor.mjs");
const studioPort = port("PIPELINE_STUDIO_STUDIO_PORT", 4310);
const controlPort = port("PIPELINE_STUDIO_CONTROL_PORT", 4312);
const gatewayPort = port("PIPELINE_AGENT_GATEWAY_PORT", 4313);
const canvasPort = port("PIPELINE_STUDIO_CANVAS_PORT", 8001);

await run(npm, ["run", "build"], root);

const services = [
  start("control-plane", process.execPath, ["dist/apps/core/src/control-plane-main.js"], root, {
    PIPELINE_STUDIO_CONTROL_PORT: String(controlPort),
    PIPELINE_STUDIO_ALLOWED_ORIGINS: `http://127.0.0.1:${studioPort}`,
  }),
  start("model-gateway", process.execPath, ["dist/apps/core/src/agent-canvas-model-gateway-main.js"], root, {
    PIPELINE_AGENT_GATEWAY_PORT: String(gatewayPort),
  }),
  start("studio", process.execPath, [vite, "--config", "apps/studio/vite.config.ts", "--port", String(studioPort), "--host", "127.0.0.1"], root, {
    VITE_PIPELINE_STUDIO_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
    VITE_PIPELINE_CANVAS_URL: `http://127.0.0.1:${canvasPort}`,
  }),
  start("agent-canvas", process.execPath, ["--env-file-if-exists=.env", "scripts/dev-with-automation.mjs"], canvasRoot, {
    OH_CANVAS_SAFE_STATE_DIR: stateDir,
    OPENHANDS_SUPPRESS_BANNER: "1",
    PORT: String(canvasPort),
    PIPELINE_AGENT_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}/v1`,
    VITE_PIPELINE_STUDIO: "true",
  }),
];

console.log("Pipeline Studio is starting on loopback.");
console.log(`Open: http://127.0.0.1:${studioPort}`);
console.log("Paid model routing remains disabled.");

let stopping = false;
const launcherParentPid = process.ppid;
for (const service of services) {
  service.child.once("error", () => stop(1, `${service.name} failed to start`));
  service.child.once("exit", (code, signal) => {
    if (!stopping) stop(code ?? 1, `${service.name} stopped (${signal ?? `exit ${code ?? 1}`})`);
  });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) {
  process.once(signal, () => stop(0, signal));
}
process.once("exit", () => {
  for (const { child } of services) signal(child, "SIGTERM");
});
const parentWatch = setInterval(() => {
  if (process.ppid === 1 || process.ppid !== launcherParentPid) {
    stop(0, "launcher parent stopped");
  }
}, 500);
parentWatch.unref();

await new Promise(() => undefined);

function start(name, command, args, cwd, extraEnv = {}) {
  return {
    name,
    child: spawn(process.execPath, [supervisor], {
      cwd,
      stdio: "inherit",
      // Give every top-level service a process group. The launcher can then
      // terminate the exact Codkesh service tree instead of leaving an
      // ingress, Vite, or Python worker listening after an interrupted run.
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...extraEnv,
        CODKESH_SERVICE_NAME: name,
        CODKESH_SERVICE_COMMAND: command,
        CODKESH_SERVICE_ARGS: JSON.stringify(args),
        CODKESH_SERVICE_CWD: cwd,
        CODKESH_LAUNCHER_PID: String(process.pid),
      },
    }),
  };
}

function stop(code, reason) {
  if (stopping) return;
  stopping = true;
  console.error(`Stopping local stack: ${reason}`);
  for (const { child } of services) signal(child, "SIGTERM");
  const timeout = setTimeout(() => {
    for (const { child } of services) signal(child, "SIGKILL");
  }, 5_000);
  timeout.unref();
  Promise.all(services.map(({ child }) => wait(child))).then(() => process.exit(code));
}

function signal(child, name) {
  try {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform !== "win32" && child.pid) {
      // The embedded canvas starts some workers in their own process groups.
      // Snapshot and signal every owned descendant before the group leader so
      // an interrupted launcher cannot orphan Python, ingress, or Vite ports.
      for (const pid of descendantPids(child.pid).reverse()) {
        try { process.kill(pid, name); } catch { /* Descendant already stopped. */ }
      }
      process.kill(-child.pid, name);
      return;
    }
    child.kill(name);
  } catch {
    // The exact child already stopped.
  }
}

function descendantPids(rootPid) {
  try {
    const rows = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
      .trim().split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(([pid, parent]) => Number.isInteger(pid) && Number.isInteger(parent));
    const children = new Map();
    for (const [pid, parent] of rows) children.set(parent, [...(children.get(parent) ?? []), pid]);
    const result = [];
    const visit = (pid) => { for (const childPid of children.get(pid) ?? []) { result.push(childPid); visit(childPid); } };
    visit(rootPid);
    return result;
  } catch {
    return [];
  }
}

function wait(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error(`${name} must be a user port between 1024 and 65535.`);
  }
  return value;
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Build failed with exit ${code ?? 1}.`)));
  });
}
