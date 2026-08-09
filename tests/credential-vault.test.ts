import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EncryptedFileCredentialBackend,
  OperatingSystemCredentialVault,
  ProviderCredentialVaultBridge,
  SqliteCredentialMetadataRepository,
  createOperatingSystemCredentialBackend,
  linuxSecretServiceCommands,
  macosKeychainCommands,
  windowsCredentialManagerCommands,
  type NativeCredentialBackend
} from "../packages/vault/src/index.js";

const now = 1_800_000_000_000;
const reference = "vault:providers/groq/primary";
const value = "fixture-access-material";

class MemoryBackend implements NativeCredentialBackend {
  public readonly kind = "macos_keychain" as const;
  public readonly available = true;
  public readonly values = new Map<string, string>();

  public async write(key: string, input: string): Promise<void> {
    this.values.set(key, input);
  }

  public async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function access(
  purpose: "validate" | "invoke" | "rotate" | "revoke" | "delete",
  providerId = "groq"
) {
  return {
    serviceIdentity: "pipeline-studio-local-core" as const,
    providerId,
    purpose
  };
}

test("vault stores only opaque metadata in SQLite and scopes access to provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-vault-"));
  const database = join(root, "vault.sqlite");
  const backend = new MemoryBackend();
  const repository = new SqliteCredentialMetadataRepository(database);
  const vault = new OperatingSystemCredentialVault(backend, repository);
  const created = await vault.create({
    reference,
    providerId: "groq",
    value,
    now
  });

  assert.equal(created.reference, reference);
  assert.equal(await vault.access(reference, access("invoke")), value);
  await assert.rejects(
    () => vault.access(reference, access("invoke", "gemini")),
    /different provider/
  );
  assert.equal((await readFile(database)).includes(Buffer.from(value)), false);
  assert.doesNotMatch(JSON.stringify(repository.list()), new RegExp(value));
});

test("rotation, revocation, export exclusion, and deletion are deterministic", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-vault-life-"));
  const backend = new MemoryBackend();
  const repository = new SqliteCredentialMetadataRepository(join(root, "vault.sqlite"));
  const vault = new OperatingSystemCredentialVault(backend, repository);
  await vault.create({ reference, providerId: "groq", value, now });
  const rotated = await vault.rotate({
    reference,
    providerId: "groq",
    value: "rotated-fixture-material",
    now: now + 1,
    access: access("rotate")
  });
  assert.notEqual(rotated.fingerprint, repository.read(reference)?.createdAt);
  assert.equal(JSON.stringify(vault.exportMetadata()).includes("fingerprint"), false);

  const revoked = await vault.revoke(reference, access("revoke"), now + 2);
  assert.equal(revoked.state, "revoked");
  assert.equal(backend.values.size, 0);
  await vault.delete(reference, access("delete"));
  assert.equal(repository.read(reference), null);
});

test("native command adapters never place credential material in process arguments", () => {
  const commands = [
    macosKeychainCommands(),
    linuxSecretServiceCommands(),
    windowsCredentialManagerCommands()
  ];
  for (const adapter of commands) {
    const write = adapter.write(reference, value);
    assert.equal(write.args.includes(value), false);
    if (write.executable === "/usr/bin/security") {
      assert.equal(write.args[0], "-i");
      assert.equal(write.stdin?.includes(value), false);
      assert.match(write.stdin ?? "", /^add-generic-password .* -w "ps1:[A-Za-z0-9+/]+=*"\n$/);
    } else {
      assert.equal(write.stdin, value);
    }
    assert.equal(write.outputContainsSecret, false);
    assert.equal(adapter.read(reference).outputContainsSecret, true);
  }
});

test("platform selection chooses the matching operating-system store", () => {
  const runner = {
    async run() {
      return { stdout: "" };
    }
  };
  assert.equal(
    createOperatingSystemCredentialBackend({
      platform: "darwin",
      available: true,
      runner
    }).kind,
    "macos_keychain"
  );
  assert.equal(
    createOperatingSystemCredentialBackend({
      platform: "win32",
      available: true,
      runner
    }).kind,
    "windows_credential_manager"
  );
  assert.equal(
    createOperatingSystemCredentialBackend({
      platform: "linux",
      available: true,
      runner
    }).kind,
    "linux_secret_service"
  );
});

test("encrypted fallback writes authenticated ciphertext with private content excluded", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-encrypted-vault-"));
  const path = join(root, "credentials.enc");
  const backend = new EncryptedFileCredentialBackend(
    path,
    async () => "correct horse battery staple"
  );
  await backend.write(reference, value);
  assert.equal((await readFile(path, "utf8")).includes(value), false);
  assert.equal(await backend.read(reference), value);
  await backend.delete(reference);
  assert.equal(await backend.read(reference), null);
});

test("unavailable native store fails closed and names the safe fallback", () => {
  const backend: NativeCredentialBackend = {
    kind: "linux_secret_service",
    available: false,
    async write() {},
    async read() { return null; },
    async delete() {}
  };
  assert.throws(
    () => new OperatingSystemCredentialVault(
      backend,
      new SqliteCredentialMetadataRepository(":memory:")
    ),
    /encrypted fallback/
  );
});

test("provider lifecycle bridge rotates in place and never exposes metadata", async () => {
  const backend = new MemoryBackend();
  const repository = new SqliteCredentialMetadataRepository(":memory:");
  const bridge = new ProviderCredentialVaultBridge(
    new OperatingSystemCredentialVault(backend, repository),
    () => now
  );
  await bridge.write(reference, value);
  await bridge.write(reference, "replacement-access-material");
  assert.equal(await bridge.read(reference), "replacement-access-material");
  assert.equal(repository.list().length, 1);
  await bridge.delete(reference);
  assert.equal(await bridge.read(reference), null);
});
