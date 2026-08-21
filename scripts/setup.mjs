import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { arch, freemem, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const repairRequested = args.has("--repair");
const stateDirectory = resolve(
  process.env.PIPELINE_STUDIO_STATE_DIR ?? ".pipeline-studio"
);
const statePath = resolve(stateDirectory, "setup-state.json");
const embeddedCanvasRoot = resolve("engine");
const embeddedCanvasEntry = resolve(embeddedCanvasRoot, "node_modules", ".bin", "react-router");

const nodeMajor = Number(process.versions.node.split(".")[0]);
const npmVersion = await versionOf("npm", ["--version"]);
const gitVersion = await versionOf("git", ["--version"]);
const npmMajor = Number(npmVersion?.split(".")[0] ?? 0);
const selectedPort = await findLoopbackPort(4310);
const memoryGb = totalmem() / 1024 ** 3;
const embeddedCanvasReady =
  (await pathExists(embeddedCanvasEntry)) || (await installEmbeddedCanvas());

const checks = [
  check("Node.js 22+", nodeMajor >= 22, `Node ${process.versions.node}`),
  check("npm 10+", npmMajor >= 10, npmVersion ? `npm ${npmVersion}` : "npm not found"),
  check("Git", gitVersion !== null, gitVersion ?? "Git not found"),
  check(
    "Coding canvas",
    embeddedCanvasReady,
    embeddedCanvasReady ? "Embedded engine ready" : "Embedded engine dependencies could not be installed"
  ),
  check("Supported platform", ["darwin", "linux", "win32"].includes(platform()), `${platform()}/${arch()}`),
  check("8 GB memory", memoryGb >= 7, `${memoryGb.toFixed(1)} GB detected`),
  check("Loopback port", selectedPort !== null, selectedPort ? `127.0.0.1:${selectedPort}` : "No bounded port available"),
];

await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
await chmod(stateDirectory, 0o700);
const previous = await readJson(statePath);
const ready = checks.every((item) => item.ready);
const state = {
  schemaVersion: 1,
  profileId: "default",
  status: ready ? "ready" : "needs_action",
  selectedPort,
  loopbackHost: "127.0.0.1",
  isolation: "native_bounded",
  isolationStrength: "reduced",
  credentialStore: "operating_system",
  configuration:
    previous && typeof previous.configuration === "object"
      ? previous.configuration
      : {},
  repair: repairRequested
    ? {
        result: ready ? "safe_to_apply" : "needs_user",
        preserved: ["projects", "credentials", "checkpoints"],
      }
    : null,
  checks,
  machine: {
    platform: platform(),
    architecture: arch(),
    memoryGb: Number(memoryGb.toFixed(1)),
    freeMemoryGb: Number((freemem() / 1024 ** 3).toFixed(1)),
  },
  updatedAt: new Date().toISOString(),
};

await atomicPrivateWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);

if (jsonOutput) {
  console.log(JSON.stringify(state));
} else {
  console.log(ready ? "Pipeline Studio is ready." : "Pipeline Studio needs attention.");
  for (const item of checks) {
    console.log(`${item.ready ? "✓" : "!"} ${item.label}: ${item.detail}`);
  }
  console.log(
    `Runtime state: ${statePath.replace(process.cwd(), ".")} (credentials are not stored here)`
  );
  if (ready) {
    console.log("Next: npm start");
  } else {
    console.log("Fix the items marked !, then run npm run setup again.");
  }
}

if (!ready) process.exitCode = 1;

function check(label, ready, detail) {
  return { label, ready, detail };
}

async function versionOf(command, commandArgs) {
  try {
    const { stdout } = await execFileAsync(command, commandArgs, {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
      },
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function installEmbeddedCanvas() {
  if (!(await pathExists(resolve(embeddedCanvasRoot, "package-lock.json")))) return false;
  try {
    await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--prefix", embeddedCanvasRoot], {
      encoding: "utf8",
      timeout: 20 * 60_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
      env: process.env,
    });
    return await pathExists(embeddedCanvasEntry);
  } catch {
    return false;
  }
}

async function findLoopbackPort(preferred) {
  for (let port = preferred; port <= preferred + 50; port += 1) {
    const available = await canBind(port);
    if (available) return port;
  }
  return null;
}

async function canBind(port) {
  return await new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function readJson(path) {
  try {
    await stat(path);
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function atomicPrivateWrite(path, content) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
