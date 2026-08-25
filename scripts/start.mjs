import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const studioPort = parsePort(
  process.env.PIPELINE_STUDIO_STUDIO_PORT,
  4_310,
  "PIPELINE_STUDIO_STUDIO_PORT"
);
const controlPort = parsePort(
  process.env.PIPELINE_STUDIO_CONTROL_PORT,
  4_312,
  "PIPELINE_STUDIO_CONTROL_PORT"
);
if (studioPort === controlPort) {
  throw new Error("Studio and control plane require different loopback ports.");
}
const studioOrigin = `http://127.0.0.1:${studioPort}`;

await runBuild();

const children = [
  spawn(
    process.execPath,
    ["dist/apps/core/src/control-plane-main.js"],
    {
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        PIPELINE_STUDIO_CONTROL_PORT: String(controlPort),
        PIPELINE_STUDIO_ALLOWED_ORIGINS: studioOrigin,
      },
    }
  ),
  spawn(npmCommand, ["run", "studio:dev", "--", "--port", String(studioPort)], {
    stdio: "inherit",
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      VITE_PIPELINE_STUDIO_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
    },
  }),
];

let stopping = false;
let exitCode = 0;
let finish;
const finished = new Promise((resolvePromise) => {
  finish = resolvePromise;
});

for (const child of children) {
  child.once("error", () => stop(1));
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `A local service stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).`
      );
      stop(code ?? 1);
    }
  });
}

console.log("Starting Codkesh on loopback.");
console.log(`Studio: ${studioOrigin}`);
console.log(`Control plane: http://127.0.0.1:${controlPort}/api/v1/health`);
console.log("Press Ctrl+C to stop both foreground services.");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(0));
}

process.exitCode = await finished;

function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      signalChild(child, "SIGTERM");
    }
  }
  const timeout = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        signalChild(child, "SIGKILL");
      }
    }
  }, 5_000);
  timeout.unref();
  Promise.all(children.map(waitForExit)).then(() => {
    clearTimeout(timeout);
    finish(exitCode);
  });
}

function signalChild(child, signal) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already be gone.
    }
  }
  child.kill(signal);
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

function runBuild() {
  return new Promise((resolvePromise, reject) => {
    const build = spawn(npmCommand, ["run", "build"], { stdio: "inherit" });
    build.once("error", reject);
    build.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Local control-plane build failed with exit ${code ?? 1}.`));
    });
  });
}

function parsePort(value, fallback, name) {
  const port = value ? Number(value) : fallback;
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${name} is invalid.`);
  }
  return port;
}
