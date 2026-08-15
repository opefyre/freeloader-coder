import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";

import {
  nativePickerResponseSchema,
  type NativePickerResponse,
} from "../../../packages/runtime/src/native-picker.js";
import type { NativePickerEvidence } from "./native-picker-evidence-store.js";

const execFileAsync = promisify(execFile);

export class NativePicker {
  readonly #selections = new Map<string, { kind: "folder" | "files"; path: string; expiresAt: number }>();

  constructor(
    private readonly picker: (kind: "folder" | "files") => Promise<string[]> = platformPick,
    private readonly now: () => number = Date.now,
    private readonly evidence: (input: NativePickerEvidence) => Promise<void> = async () => undefined,
  ) {}

  async folder(): Promise<NativePickerResponse> {
    return this.#pick("folder");
  }

  async files(): Promise<NativePickerResponse> {
    return this.#pick("files");
  }

  async #pick(kind: "folder" | "files"): Promise<NativePickerResponse> {
    try {
      const paths = await this.picker(kind);
      this.#discardExpired();
      const selections = await Promise.all(paths
        .map((path) => path.trim())
        .filter((path) => path && isAbsolute(path))
        .slice(0, kind === "folder" ? 1 : 20)
        .map(async (path) => {
          const canonicalPath = await validateSelection(path, kind);
          const handle = `selection_${randomBytes(16).toString("hex")}`;
          this.#selections.set(handle, { kind, path: canonicalPath, expiresAt: this.now() + 10 * 60_000 });
          return { path: handle, label: basename(canonicalPath) };
        }));
      const response = nativePickerResponseSchema.parse({
        schemaVersion: 1,
        outcome: selections.length > 0 ? "selected" : "cancelled",
        selections,
      });
      await this.#record(kind, response.outcome, selections.length);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/user canceled|cancelled|canceled/i.test(message)) {
        await this.#record(kind, "cancelled", 0);
        return nativePickerResponseSchema.parse({ schemaVersion: 1, outcome: "cancelled", selections: [] });
      }
      if (/not readable|not a regular|not a folder|symbolic link/i.test(message)) {
        await this.#record(kind, /not readable/i.test(message) ? "denied" : "invalid", 0);
        throw new Error(message);
      }
      await this.#record(kind, "unavailable", 0);
      throw new Error("The native picker could not be opened on this device. Check Files and Folders access, then try again.");
    }
  }

  async #record(kind: "folder" | "files", outcome: NativePickerEvidence["outcome"], selectionCount: number) {
    const platform = process.platform === "darwin" || process.platform === "linux" || process.platform === "win32" ? process.platform : "other";
    await this.evidence({ schemaVersion: 1, kind, outcome, selectionCount, platform, observedAt: this.now() }).catch(() => undefined);
  }

  resolveFolder(handle: string): string { return this.#resolve(handle, "folder"); }
  resolveFiles(handles: readonly string[]): readonly string[] { return handles.map((handle) => this.#resolve(handle, "files")); }

  #resolve(handle: string, kind: "folder" | "files"): string {
    this.#discardExpired();
    const selection = this.#selections.get(handle);
    if (!/^selection_[a-f0-9]{32}$/.test(handle) || !selection || selection.kind !== kind) {
      throw new Error("The selected item expired or is no longer available. Open the picker again.");
    }
    return selection.path;
  }

  #discardExpired() {
    const now = this.now();
    for (const [handle, selection] of this.#selections) if (selection.expiresAt <= now) this.#selections.delete(handle);
  }
}

async function validateSelection(path: string, kind: "folder" | "files"): Promise<string> {
  const selected = await lstat(path);
  if (selected.isSymbolicLink()) throw new Error("The selected item is a symbolic link. Choose the original item instead.");
  if (kind === "folder" && !selected.isDirectory()) throw new Error("The selected item is not a folder.");
  if (kind === "files" && !selected.isFile()) throw new Error("The selected item is not a regular file.");
  await access(path, kind === "folder" ? constants.R_OK | constants.W_OK : constants.R_OK).catch(() => {
    throw new Error(kind === "folder" ? "The selected folder is not readable and writable." : "The selected file is not readable.");
  });
  return realpath(path);
}

async function platformPick(kind: "folder" | "files"): Promise<string[]> {
  return process.platform === "darwin" ? pickOnMac(kind)
    : process.platform === "linux" ? pickOnLinux(kind)
      : process.platform === "win32" ? pickOnWindows(kind)
        : [];
}

async function pickOnMac(kind: "folder" | "files"): Promise<string[]> {
  const scripts = kind === "folder"
    ? ["POSIX path of (choose folder with prompt \"Choose project folder\")"]
    : [
        "set selectedFiles to choose file with prompt \"Choose project files\" with multiple selections allowed",
        "set output to \"\"",
        "repeat with selectedFile in selectedFiles",
        "set output to output & POSIX path of selectedFile & linefeed",
        "end repeat",
        "return output",
      ];
  const { stdout } = await execFileAsync("osascript", scripts.flatMap((script) => ["-e", script]), {
    timeout: 120_000,
    maxBuffer: 128_000,
    windowsHide: true,
  });
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function pickOnLinux(kind: "folder" | "files"): Promise<string[]> {
  const args = ["--file-selection", "--title=Codkesh"];
  if (kind === "folder") args.push("--directory");
  else args.push("--multiple", "--separator=\n");
  const { stdout } = await execFileAsync("zenity", args, { timeout: 120_000, maxBuffer: 128_000 });
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function pickOnWindows(kind: "folder" | "files"): Promise<string[]> {
  const script = kind === "folder"
    ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.SelectedPath)}"
    : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; if($d.ShowDialog() -eq 'OK'){$d.FileNames | ForEach-Object {[Console]::WriteLine($_)}}";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 120_000,
    maxBuffer: 128_000,
    windowsHide: true,
  });
  return stdout.split(/\r?\n/).filter(Boolean);
}
