import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { tenantTx } from "../../common/db/tenant-tx";
import { tr } from "../../i18n/translate";
import { AttachmentBlob } from "../entities/attachment-blob.entity";
import { AttachmentStorageProvider } from "./attachment-storage.interface";

/**
 * Stores attachment bytes in PostgreSQL (`attachment_blobs`), keyed by the
 * attachment id. All access goes through `tenantTx`; when called from within the
 * service's upload transaction the nested call joins it, so the metadata row and
 * its bytes commit or roll back together.
 */
@Injectable()
export class DatabaseStorageProvider implements AttachmentStorageProvider {
  readonly name = "database";

  constructor(private readonly dataSource: DataSource) {}

  async save(key: string, data: Buffer): Promise<void> {
    await tenantTx(this.dataSource, (m) =>
      m.getRepository(AttachmentBlob).insert({ attachmentId: key, data }),
    );
  }

  async load(key: string): Promise<Buffer> {
    const row = await tenantTx(this.dataSource, (m) =>
      m
        .getRepository(AttachmentBlob)
        .createQueryBuilder("b")
        .addSelect("b.data")
        .where("b.attachment_id = :key", { key })
        .getOne(),
    );
    if (!row) {
      throw new NotFoundException(
        tr("errors.attachments.notFound", "Attachment not found"),
      );
    }
    return row.data;
  }

  async delete(key: string): Promise<void> {
    await tenantTx(this.dataSource, (m) =>
      m.getRepository(AttachmentBlob).delete({ attachmentId: key }),
    );
  }
}
