import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DEFAULT_ATTACHMENT_CONTAINER_DIR,
  LocalStorageProvider,
} from "./local-storage.provider";

describe("LocalStorageProvider", () => {
  let baseDir: string;
  let provider: LocalStorageProvider;

  const configFor = (dir: string) =>
    ({ get: () => dir }) as unknown as ConfigService;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(join(tmpdir(), "monize-attach-"));
    provider = new LocalStorageProvider(configFor(baseDir));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("has the local name", () => {
    expect(provider.name).toBe("local");
  });

  it("round-trips saved bytes", async () => {
    const key = "11111111-1111-1111-1111-111111111111";
    const data = Buffer.from("hello attachment");
    await provider.save(key, data);
    await expect(provider.load(key)).resolves.toEqual(data);
  });

  it("fans saved bytes out into a two-level shard by id prefix", async () => {
    const key = "abcd1234-5678-4abc-9def-0123456789ab";
    await provider.save(key, Buffer.from("sharded"));

    // <baseDir>/<ab>/<cd>/<id>, not flat at <baseDir>/<id>.
    const sharded = join(baseDir, key.slice(0, 2), key.slice(2, 4), key);
    await expect(fs.readFile(sharded, "utf8")).resolves.toBe("sharded");
    await expect(fs.access(join(baseDir, key))).rejects.toBeDefined();
  });

  it("creates the shard directories on first save", async () => {
    const nested = join(baseDir, "does", "not", "exist");
    const p = new LocalStorageProvider(configFor(nested));
    const key = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await p.save(key, Buffer.from("x"));
    await expect(p.load(key)).resolves.toEqual(Buffer.from("x"));
  });

  it("loads bytes written under the pre-sharding flat layout", async () => {
    const key = "ffffffff-0000-4000-8000-000000000000";
    // Simulate an attachment written before sharding: a flat file in baseDir.
    await fs.writeFile(join(baseDir, key), "legacy");
    await expect(provider.load(key)).resolves.toEqual(Buffer.from("legacy"));
  });

  it("deletes a pre-sharding flat file too", async () => {
    const key = "ffffffff-1111-4111-8111-111111111111";
    await fs.writeFile(join(baseDir, key), "legacy");
    await expect(provider.delete(key)).resolves.toBeUndefined();
    await expect(provider.load(key)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFound when loading a missing key", async () => {
    await expect(provider.load("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("delete is idempotent", async () => {
    const key = "22222222-2222-4222-8222-222222222222";
    await provider.save(key, Buffer.from("y"));
    await expect(provider.delete(key)).resolves.toBeUndefined();
    await expect(provider.delete(key)).resolves.toBeUndefined();
    await expect(provider.load(key)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects keys that would escape the base directory", async () => {
    await expect(
      provider.save("../escape", Buffer.from("z")),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(provider.load("sub/dir")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ["..", "parent traversal segment"],
    [".", "current directory segment"],
    ["", "empty key"],
    ["../../etc/passwd", "deep traversal"],
    ["a/../../b", "embedded traversal"],
    ["file.txt", "dotted filename"],
    ["with space", "whitespace"],
    ["nul\0byte", "NUL byte"],
  ])("rejects the key %p (%s)", async (key) => {
    await expect(provider.load(key)).rejects.toBeInstanceOf(NotFoundException);
    await expect(provider.save(key, Buffer.from("x"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(provider.delete(key)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("leaves the parent directory untouched when a traversal key is used", async () => {
    const marker = join(baseDir, "..", "marker-should-survive");
    await fs.writeFile(marker, "keep");
    await expect(provider.delete("..")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(fs.readFile(marker, "utf8")).resolves.toBe("keep");
    await fs.rm(marker, { force: true });
  });

  describe("base directory configuration", () => {
    const providerFor = (env: Record<string, string>) =>
      new LocalStorageProvider({
        get: (key: string) => env[key],
      } as unknown as ConfigService);

    const baseDirOf = (p: LocalStorageProvider) =>
      (p as unknown as { baseDir: string }).baseDir;

    it("defaults to /data/attachments when unconfigured", () => {
      expect(baseDirOf(providerFor({}))).toBe(DEFAULT_ATTACHMENT_CONTAINER_DIR);
    });

    it("uses ATTACHMENT_CONTAINER_DIR when set", () => {
      const p = providerFor({ ATTACHMENT_CONTAINER_DIR: "/mnt/attachments" });
      expect(baseDirOf(p)).toBe("/mnt/attachments");
    });

    it("falls back to the deprecated ATTACHMENT_LOCAL_DIR", () => {
      const p = providerFor({ ATTACHMENT_LOCAL_DIR: "/legacy/attachments" });
      expect(baseDirOf(p)).toBe("/legacy/attachments");
    });

    it("prefers ATTACHMENT_CONTAINER_DIR over the deprecated name", () => {
      const p = providerFor({
        ATTACHMENT_CONTAINER_DIR: "/mnt/attachments",
        ATTACHMENT_LOCAL_DIR: "/legacy/attachments",
      });
      expect(baseDirOf(p)).toBe("/mnt/attachments");
    });
  });
});
