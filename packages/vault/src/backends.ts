import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  CredentialBackendKind,
  NativeCredentialBackend
} from "./contracts.js";

export interface SensitiveCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin?: string | undefined;
  readonly outputContainsSecret: boolean;
}

export interface SensitiveCommandRunner {
  run(command: SensitiveCommand): Promise<{ readonly stdout: string }>;
}

export function createOperatingSystemCredentialBackend(input: {
  readonly platform: "darwin" | "win32" | "linux";
  readonly available: boolean;
  readonly runner: SensitiveCommandRunner;
}): NativeCredentialBackend {
  if (input.platform === "darwin") {
    return new CommandCredentialBackend(
      "macos_keychain",
      input.available,
      macosKeychainCommands(),
      input.runner
    );
  }
  if (input.platform === "win32") {
    return new CommandCredentialBackend(
      "windows_credential_manager",
      input.available,
      windowsCredentialManagerCommands(),
      input.runner
    );
  }
  return new CommandCredentialBackend(
    "linux_secret_service",
    input.available,
    linuxSecretServiceCommands(),
    input.runner
  );
}

interface BackendCommands {
  readonly write: (reference: string, value: string) => SensitiveCommand;
  readonly read: (reference: string) => SensitiveCommand;
  readonly delete: (reference: string) => SensitiveCommand;
}

export class CommandCredentialBackend implements NativeCredentialBackend {
  public constructor(
    public readonly kind: CredentialBackendKind,
    public readonly available: boolean,
    private readonly commands: BackendCommands,
    private readonly runner: SensitiveCommandRunner
  ) {}

  public async write(reference: string, value: string): Promise<void> {
    await this.runner.run(this.commands.write(reference, value));
  }

  public async read(reference: string): Promise<string | null> {
    try {
      return (await this.runner.run(this.commands.read(reference))).stdout;
    } catch {
      return null;
    }
  }

  public async delete(reference: string): Promise<void> {
    await this.runner.run(this.commands.delete(reference));
  }
}

export function macosKeychainCommands(): BackendCommands {
  return {
    write: (reference, value) => ({
      executable: "/usr/bin/security",
      args: [
        "add-generic-password",
        "-U",
        "-s",
        "Pipeline Studio",
        "-a",
        reference,
        "-w"
      ],
      stdin: value,
      outputContainsSecret: false
    }),
    read: (reference) => ({
      executable: "/usr/bin/security",
      args: [
        "find-generic-password",
        "-s",
        "Pipeline Studio",
        "-a",
        reference,
        "-w"
      ],
      outputContainsSecret: true
    }),
    delete: (reference) => ({
      executable: "/usr/bin/security",
      args: [
        "delete-generic-password",
        "-s",
        "Pipeline Studio",
        "-a",
        reference
      ],
      outputContainsSecret: false
    })
  };
}

export function linuxSecretServiceCommands(): BackendCommands {
  return {
    write: (reference, value) => ({
      executable: "secret-tool",
      args: [
        "store",
        "--label=Pipeline Studio provider credential",
        "service",
        "pipeline-studio",
        "reference",
        reference
      ],
      stdin: value,
      outputContainsSecret: false
    }),
    read: (reference) => ({
      executable: "secret-tool",
      args: [
        "lookup",
        "service",
        "pipeline-studio",
        "reference",
        reference
      ],
      outputContainsSecret: true
    }),
    delete: (reference) => ({
      executable: "secret-tool",
      args: [
        "clear",
        "service",
        "pipeline-studio",
        "reference",
        reference
      ],
      outputContainsSecret: false
    })
  };
}

export function windowsCredentialManagerCommands(): BackendCommands {
  const script = [
    "$operation=$args[0]",
    "$reference=$args[1]",
    "$vault=New-Object Windows.Security.Credentials.PasswordVault",
    "if($operation -eq 'write'){",
    "$value=[Console]::In.ReadToEnd()",
    "$item=New-Object Windows.Security.Credentials.PasswordCredential('Pipeline Studio',$reference,$value)",
    "$vault.Add($item)",
    "} elseif($operation -eq 'read'){",
    "$item=$vault.Retrieve('Pipeline Studio',$reference)",
    "$item.RetrievePassword()",
    "$item.Password",
    "} elseif($operation -eq 'delete'){",
    "$item=$vault.Retrieve('Pipeline Studio',$reference)",
    "$vault.Remove($item)",
    "}"
  ].join(";");
  const command = (
    operation: "write" | "read" | "delete",
    reference: string,
    value?: string
  ): SensitiveCommand => ({
    executable: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      operation,
      reference
    ],
    ...(value === undefined ? {} : { stdin: value }),
    outputContainsSecret: operation === "read"
  });
  return {
    write: (reference, value) => command("write", reference, value),
    read: (reference) => command("read", reference),
    delete: (reference) => command("delete", reference)
  };
}

interface EncryptedDocument {
  readonly version: 1;
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export class EncryptedFileCredentialBackend implements NativeCredentialBackend {
  public readonly kind = "encrypted_file" as const;
  public readonly available = true;

  public constructor(
    private readonly root: string,
    private readonly passphrase: () => Promise<string>
  ) {}

  public async write(reference: string, value: string): Promise<void> {
    const document = await this.load();
    document[reference] = value;
    await this.save(document);
  }

  public async read(reference: string): Promise<string | null> {
    return (await this.load())[reference] ?? null;
  }

  public async delete(reference: string): Promise<void> {
    const document = await this.load();
    delete document[reference];
    await this.save(document);
  }

  private async load(): Promise<Record<string, string>> {
    try {
      const encrypted = JSON.parse(
        await readFile(this.root, "utf8")
      ) as EncryptedDocument;
      if (encrypted.version !== 1) throw new Error("Unsupported encrypted vault version.");
      const salt = Buffer.from(encrypted.salt, "base64");
      const key = scryptSync(await this.passphrase(), salt, 32);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(encrypted.iv, "base64")
      );
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
        decipher.final()
      ]);
      return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return {};
      throw error;
    }
  }

  private async save(values: Record<string, string>): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(await this.passphrase(), salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(values), "utf8"),
      cipher.final()
    ]);
    const document: EncryptedDocument = {
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    await mkdir(dirname(this.root), { recursive: true, mode: 0o700 });
    const temporary = `${this.root}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, this.root);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
