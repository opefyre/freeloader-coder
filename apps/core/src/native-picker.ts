import { execFile } from "node:child_process";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";

import {
  nativePickerResponseSchema,
  type NativePickerResponse,
} from "../../../packages/runtime/src/native-picker.js";

const execFileAsync = promisify(execFile);

export class NativePicker {
  async folder(): Promise<NativePickerResponse> {
    return this.#pick("folder");
  }

  async files(): Promise<NativePickerResponse> {
    return this.#pick("files");
  }

  async #pick(kind: "folder" | "files"): Promise<NativePickerResponse> {
    try {
      const paths = process.platform === "darwin"
        ? await pickOnMac(kind)
        : process.platform === "linux"
          ? await pickOnLinux(kind)
          : process.platform === "win32"
            ? await pickOnWindows(kind)
            : [];
      const selections = paths
        .map((path) => path.trim())
        .filter((path) => path && isAbsolute(path))
        .slice(0, kind === "folder" ? 1 : 20)
        .map((path) => ({ path, label: basename(path) }));
      return nativePickerResponseSchema.parse({
        schemaVersion: 1,
        outcome: selections.length > 0 ? "selected" : "cancelled",
        selections,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/user canceled|cancelled|canceled/i.test(message)) {
        return nativePickerResponseSchema.parse({ schemaVersion: 1, outcome: "cancelled", selections: [] });
      }
      throw new Error("The native picker could not be opened on this device.");
    }
  }
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
  const args = ["--file-selection", "--title=Pipeline Studio"];
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
