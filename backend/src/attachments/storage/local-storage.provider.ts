import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "fs";
import { basename, dirname, resolve, sep } from "path";
import { tr } from "../../i18n/translate";
import { AttachmentStorageProvider } from "./attachment-storage.interface";

/**
 * Folder attachment bytes are written to when ATTACHMENT_CONTAINER_DIR is unset.
 * Monize runs in a container, so this is a container path: mount a host folder
 * there (see .env.example and the docker-compose files).
 */
export const DEFAULT_ATTACHMENT_CONTAINER_DIR = "/data/attachments";

/**
 * Stores attachment bytes on the local filesystem under
 * ATTACHMENT_CONTAINER_DIR, one file per attachment named by its `key` (the
 * attachment id). Chosen by ATTACHMENT_STORAGE_PROVIDER=local -- a
 * zero-dependency alternative to Postgres BYTEA for deployments that would
 * rather keep large blobs off the database (e.g. a mounted volume) without
 * running object storage.
 *
 * Files are fanned out into two levels of subdirectory keyed by the first four
 * hex characters of the id (`<ab>/<cd>/<id>`) rather than dumped flat into a
 * single directory. A flat layout piles every attachment into one directory,
 * and a directory with tens of thousands of entries stalls on filesystems that
 * scan it linearly (ext3) or reach it over the network (NFS/CIFS/overlay):
 * enumeration by backups, rsync and `ls` degrades even where individual
 * lookups stay fast. Two hex bytes give 65536 buckets, so a directory only
 * approaches the ~10k-entry danger zone past hundreds of millions of
 * attachments; the ids are random UUIDs, so the spread is even for free.
 *
 * Bytes live outside the database, so they are not embedded in the application
 * backup; only the metadata row travels with a backup and the directory must be
 * backed up alongside it (see .env.example).
 */
@Injectable()
export class LocalStorageProvider implements AttachmentStorageProvider {
  readonly name = "local";
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    // ATTACHMENT_LOCAL_DIR is the pre-rename name. Existing deployments keep
    // working on it -- ignoring it would point the provider at a different
    // folder and hide every attachment already written.
    const configured = config.get<string>("ATTACHMENT_CONTAINER_DIR");
    const legacy = config.get<string>("ATTACHMENT_LOCAL_DIR");
    if (!configured && legacy) {
      this.logger.warn(
        "ATTACHMENT_LOCAL_DIR is deprecated; rename it to ATTACHMENT_CONTAINER_DIR",
      );
    }
    this.baseDir = resolve(
      configured ?? legacy ?? DEFAULT_ATTACHMENT_CONTAINER_DIR,
    );
  }

  /**
   * Keys are server-generated UUIDs. The allowlist deliberately excludes `.`,
   * so traversal segments (`.`, `..`) and separators cannot be expressed at all.
   */
  private static readonly SAFE_KEY = /^[A-Za-z0-9_-]+$/;

  /**
   * Validate `key` and return it. Keys are server-generated, but treat them as
   * untrusted: strip any directory component and require the result to be an
   * unchanged allowlisted filename. A key that survives this cannot contain a
   * separator, a dot, or a NUL, so any shard path derived from it stays inside
   * `baseDir` by construction.
   */
  private safeKey(key: string): string {
    const safe = basename(key ?? "");
    if (
      !safe ||
      safe !== key ||
      !LocalStorageProvider.SAFE_KEY.test(safe) ||
      safe.includes("\0")
    ) {
      throw new NotFoundException(
        tr("errors.attachments.notFound", "Attachment not found"),
      );
    }
    return safe;
  }

  /** Resolve a path inside `baseDir`, asserting containment before use. */
  private contained(...segments: string[]): string {
    const target = resolve(this.baseDir, ...segments);
    if (!target.startsWith(`${this.baseDir}${sep}`)) {
      throw new NotFoundException(
        tr("errors.attachments.notFound", "Attachment not found"),
      );
    }
    return target;
  }

  /** Sharded path for `safe`: `<baseDir>/<ab>/<cd>/<id>`. */
  private shardedPath(safe: string): string {
    return this.contained(safe.slice(0, 2), safe.slice(2, 4), safe);
  }

  /**
   * Flat path for `safe` -- the layout used before sharding was introduced.
   * Read and delete fall back to it so attachments written by an earlier
   * version keep resolving without a migration pass; new writes always shard.
   */
  private legacyPath(safe: string): string {
    return this.contained(safe);
  }

  async save(key: string, data: Buffer): Promise<void> {
    const target = this.shardedPath(this.safeKey(key));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async load(key: string): Promise<Buffer> {
    const safe = this.safeKey(key);
    try {
      return await fs.readFile(this.shardedPath(safe));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    // Fall back to the pre-sharding flat layout.
    try {
      return await fs.readFile(this.legacyPath(safe));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundException(
          tr("errors.attachments.notFound", "Attachment not found"),
        );
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const safe = this.safeKey(key);
    // Idempotent: remove the bytes under whichever layout they were written;
    // a missing file at either path is already deleted.
    await this.unlinkIfPresent(this.shardedPath(safe));
    await this.unlinkIfPresent(this.legacyPath(safe));
  }

  private async unlinkIfPresent(target: string): Promise<void> {
    try {
      await fs.unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}
