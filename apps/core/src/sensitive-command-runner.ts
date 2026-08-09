import { spawn } from "node:child_process";

import type {
  SensitiveCommand,
  SensitiveCommandRunner,
} from "../../../packages/vault/src/backends.js";

const MAX_OUTPUT_BYTES = 65_536;
const TIMEOUT_MS = 15_000;

export class LocalSensitiveCommandRunner implements SensitiveCommandRunner {
  public async run(command: SensitiveCommand): Promise<{ readonly stdout: string }> {
    if (!isAllowedExecutable(command.executable)) {
      throw new Error("Credential backend executable is not allowlisted.");
    }
    return new Promise((resolve, reject) => {
      const child = spawn(command.executable, [...command.args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? "",
          LANG: "C",
        },
        shell: false,
      });
      const stdout: Buffer[] = [];
      let bytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve({ stdout: Buffer.concat(stdout).toString("utf8").trim() });
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("Credential backend timed out."));
      }, TIMEOUT_MS);
      timer.unref();
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new Error("Credential backend output exceeded its limit."));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new Error("Credential backend diagnostic exceeded its limit."));
        }
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (code === 0) finish();
        else finish(new Error("Credential backend command failed."));
      });
      if (command.stdin !== undefined) child.stdin.end(terminateSensitiveInput(command));
      else child.stdin.end();
    });
  }
}

export function terminateSensitiveInput(command: SensitiveCommand) {
  if (command.executable === "/usr/bin/security" && command.args[0] === "add-generic-password") return `${command.stdin ?? ""}\n`;
  return command.stdin ?? "";
}

function isAllowedExecutable(executable: string): boolean {
  return [
    "/usr/bin/security",
    "secret-tool",
    "powershell.exe",
  ].includes(executable);
}
