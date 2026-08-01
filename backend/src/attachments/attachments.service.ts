import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { DataSource } from "typeorm";
import { tenantTx } from "../common/db/tenant-tx";
import { tr } from "../i18n/translate";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionAttachment } from "./entities/transaction-attachment.entity";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  sniffAttachmentMime,
} from "./attachment-mime.util";
import {
  ATTACHMENT_STORAGE_PROVIDER,
  AttachmentStorageProvider,
} from "./storage/attachment-storage.interface";

/** Largest single attachment we accept (also enforced by the upload interceptor). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
/** Maximum attachments per transaction. */
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;

export interface AttachmentDownload {
  data: Buffer;
  contentType: string;
  filename: string;
  byteSize: number;
}

/**
 * Uploaded file shape we depend on -- a subset of Express.Multer.File so callers
 * (and tests) need not construct the full multer object.
 */
export interface UploadedAttachmentFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(ATTACHMENT_STORAGE_PROVIDER)
    private readonly storage: AttachmentStorageProvider,
  ) {}

  /**
   * Store an uploaded file against a transaction. Validates size, sniffs the
   * real MIME type (never trusting the client), enforces the per-transaction
   * cap, and writes metadata + bytes in one transaction so a storage failure
   * rolls the metadata row back.
   */
  async create(
    userId: string,
    transactionId: string,
    file: UploadedAttachmentFile | undefined,
  ): Promise<TransactionAttachment> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        tr("errors.attachments.empty", "Uploaded file is empty"),
      );
    }
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException(
        tr(
          "errors.attachments.fileTooLarge",
          `File exceeds the maximum size of ${MAX_ATTACHMENT_BYTES} bytes`,
          { max: MAX_ATTACHMENT_BYTES },
        ),
      );
    }

    const contentType = sniffAttachmentMime(file.buffer);
    if (!contentType) {
      const types = ALLOWED_ATTACHMENT_MIME_TYPES.join(", ");
      throw new UnsupportedMediaTypeException(
        tr(
          "errors.attachments.unsupportedType",
          `Unsupported file type. Allowed types: ${types}`,
          { types },
        ),
      );
    }

    const filename = sanitizeFilename(file.originalname);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const id = randomUUID();

    return tenantTx(this.dataSource, async (m) => {
      const transaction = await m
        .getRepository(Transaction)
        .findOne({ where: { id: transactionId, userId } });
      if (!transaction) {
        throw new NotFoundException(
          tr("errors.attachments.transactionNotFound", "Transaction not found"),
        );
      }

      const existing = await m
        .getRepository(TransactionAttachment)
        .count({ where: { transactionId, userId } });
      if (existing >= MAX_ATTACHMENTS_PER_TRANSACTION) {
        throw new BadRequestException(
          tr(
            "errors.attachments.tooMany",
            `This transaction already has the maximum of ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments`,
            { max: MAX_ATTACHMENTS_PER_TRANSACTION },
          ),
        );
      }

      const repo = m.getRepository(TransactionAttachment);
      const attachment = repo.create({
        id,
        userId,
        transactionId,
        filename,
        contentType,
        byteSize: file.buffer.length,
        sha256,
        storageProvider: this.storage.name,
        storageKey: id,
      });
      const saved = await repo.save(attachment);

      // Nested tenantTx joins this transaction, so the bytes and the metadata
      // row commit together (or roll back together on failure).
      await this.storage.save(id, file.buffer);

      return saved;
    });
  }

  /** List attachment metadata for one of the user's transactions (no bytes). */
  async findAllForTransaction(
    userId: string,
    transactionId: string,
  ): Promise<TransactionAttachment[]> {
    return tenantTx(this.dataSource, (m) =>
      m.getRepository(TransactionAttachment).find({
        where: { transactionId, userId },
        order: { createdAt: "ASC" },
      }),
    );
  }

  /** Load one attachment's bytes and headers for streaming download. */
  async getForDownload(
    userId: string,
    id: string,
  ): Promise<AttachmentDownload> {
    const attachment = await tenantTx(this.dataSource, (m) =>
      m.getRepository(TransactionAttachment).findOne({ where: { id, userId } }),
    );
    if (!attachment) {
      throw new NotFoundException(
        tr("errors.attachments.notFound", "Attachment not found"),
      );
    }

    const data = await this.storage.load(attachment.storageKey);
    return {
      data,
      contentType: attachment.contentType,
      filename: attachment.filename,
      byteSize: attachment.byteSize,
    };
  }

  /** Delete an attachment (metadata + bytes) the user owns. */
  async remove(userId: string, id: string): Promise<void> {
    const attachment = await tenantTx(this.dataSource, (m) =>
      m.getRepository(TransactionAttachment).findOne({ where: { id, userId } }),
    );
    if (!attachment) {
      throw new NotFoundException(
        tr("errors.attachments.notFound", "Attachment not found"),
      );
    }

    await tenantTx(this.dataSource, async (m) => {
      // Removing the metadata row cascades to attachment_blobs for the database
      // provider; still call the provider so external stores are cleaned up too.
      await m.getRepository(TransactionAttachment).delete({ id, userId });
      await this.storage.delete(attachment.storageKey);
    });
  }
}

/**
 * Reduce a client-supplied filename to a safe display name: strip any path
 * components and control characters, collapse to a fallback when empty, and cap
 * at the column length.
 */
export function sanitizeFilename(raw: string | undefined): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  // Remove control chars (including CR/LF) that could break Content-Disposition.
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  const safe = cleaned.length > 0 ? cleaned : "attachment";
  return safe.slice(0, 255);
}
