import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { DataSource } from "typeorm";
import { tenantTx } from "../common/db/tenant-tx";
import { tr } from "../i18n/translate";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  sniffAttachmentMime,
} from "./attachment-mime.util";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  sanitizeFilename,
} from "./attachments.service";
import { TransactionAttachment } from "./entities/transaction-attachment.entity";

/** A file offered to the AI/MCP tool layer for attaching to a transaction. */
export interface AttachmentToolFile {
  filename: string;
  buffer: Buffer;
}

/**
 * Dry-run result for one file: everything the confirmation card and the signed
 * action descriptor need, without persisting anything.
 */
export interface AttachmentPreview {
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}

/**
 * Shared dry-run validation for the AI Assistant and MCP `manage_transactions`
 * attachment support. Runs the same checks `AttachmentsService.create` enforces
 * at commit time (size, magic-byte MIME sniff, per-transaction cap) so a
 * confirmation card is only proposed for files that will actually save. The
 * commit path re-validates everything inside its own transaction, so a pass
 * here is advisory, not a grant.
 */
@Injectable()
export class AttachmentToolPrepService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Validate a set of candidate files and return their previews. When
   * `existingTransactionId` is provided (update path), the per-transaction cap
   * counts the transaction's current attachments; on create the transaction
   * does not exist yet so only the new files count.
   */
  async prepareAttachments(
    userId: string,
    files: AttachmentToolFile[],
    existingTransactionId?: string,
  ): Promise<AttachmentPreview[]> {
    if (files.length === 0) {
      return [];
    }

    const existing = existingTransactionId
      ? await tenantTx(this.dataSource, (m) =>
          m.getRepository(TransactionAttachment).count({
            where: { transactionId: existingTransactionId, userId },
          }),
        )
      : 0;
    if (existing + files.length > MAX_ATTACHMENTS_PER_TRANSACTION) {
      throw new BadRequestException(
        tr(
          "errors.attachments.tooMany",
          `This transaction already has the maximum of ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments`,
          { max: MAX_ATTACHMENTS_PER_TRANSACTION },
        ),
      );
    }

    return files.map((file) => this.prepareOne(file));
  }

  private prepareOne(file: AttachmentToolFile): AttachmentPreview {
    if (!file.buffer || file.buffer.length === 0) {
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

    return {
      filename: sanitizeFilename(file.filename),
      contentType,
      byteSize: file.buffer.length,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
    };
  }
}
