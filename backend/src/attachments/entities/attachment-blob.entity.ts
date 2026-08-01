import { Entity, PrimaryColumn, Column } from "typeorm";
import { Exclude } from "class-transformer";

/**
 * Raw attachment bytes for the built-in "database" storage provider. Kept in a
 * separate table from the metadata so list/find queries never load BYTEA.
 *
 * `data` is never selected by default (`select: false`) and never serialized
 * (`@Exclude()`) -- the bytes reach the client only through the dedicated
 * download stream. External providers (e.g. S3) store nothing here.
 */
@Entity("attachment_blobs")
export class AttachmentBlob {
  @PrimaryColumn({ type: "uuid", name: "attachment_id" })
  attachmentId: string;

  @Exclude()
  @Column({ type: "bytea", select: false })
  data: Buffer;
}
