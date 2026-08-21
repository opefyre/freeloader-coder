import { execFileSync, spawn } from "node:child_process";

const name = process.env.CODKESH_SERVICE_NAME ?? "local service";
const command = process.env.CODKESH_SERVICE_COMMAND;
const args = JSON.parse(process.env.CODKESH_SERVICE_ARGS ?? "[]");
const cwd = process.env.CODKESH_SERVICE_CWD;
const launcherPid = Number(process.env.CODKESH_LAUNCHER_PID);

if (!command || !cwd || !Number.isInteger(launcherPid) || launcherPid <= 1 || !Array.isArray(args)) {
  throw new Error("The Codkesh service supervisor received an invalid launch contract.");
}

const child = spawn(command, args, {
  cwd,
  stdio: "inherit",
  env: withoutSupervisorContract(process.env),
});

let stopping = false;
for (const signalName of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) {
  process.once(signalName, () => stop(0, signalName));
}
child.once("error", () => stop(1, `${name} failed to start`));
child.once("exit", (code, signalName) => {
  if (!stopping) stop(code ?? 1, `${name} stopped (${signalName ?? `exit ${code ?? 1}`})`);
});

const parentWatch = setInterval(() => {
  if (!isAlive(launcherPid) || process.ppid === 1) stop(0, "launcher stopped");
}, 250);

await new Promise(() => undefined);

function stop(code, reason) {
  if (stopping) return;
  stopping = true;
  clearInterval(parentWatch);
  console.error(`Stopping ${name}: ${reason}`);
  signalTree(child.pid, "SIGTERM");
  const timeout = setTimeout(() => signalTree(child.pid, "SIGKILL"), 5_000);
  timeout.unref();
  wait(child).then(() => process.exit(code));
}

function signalTree(rootPid, signalName) {
  if (!rootPid) return;
  for (const pid of descendantPids(rootPid).reverse()) {
    try { process.kill(pid, signalName); } catch { /* Process already stopped. */ }
  }
  try { process.kill(rootPid, signalName); } catch { /* Process already stopped. */ }
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

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function wait(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => processHandle.once("exit", resolvePromise));
}

function withoutSupervisorContract(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("CODKESH_SERVICE_") && key !== "CODKESH_LAUNCHER_PID"));
}
