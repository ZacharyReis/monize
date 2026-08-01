import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { User } from "../../users/entities/user.entity";
import { Transaction } from "../../transactions/entities/transaction.entity";

/**
 * Metadata for a file attached to a transaction (receipt, invoice, document).
 *
 * Provider-agnostic: the bytes themselves live wherever `storageProvider` points
 * -- the built-in "database" provider keeps them in `attachment_blobs`, keyed by
 * `storageKey`. This table stays free of BYTEA so listing attachments never
 * pulls file bytes into memory.
 */
@Entity("transaction_attachments")
@Index(["transactionId"])
export class TransactionAttachment {
  @ApiProperty({ example: "c5f5d5f0-1234-4567-890a-123456789abc" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ example: "user-uuid" })
  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;

  @ApiProperty({ example: "transaction-uuid" })
  @Column({ type: "uuid", name: "transaction_id" })
  transactionId: string;

  @ManyToOne(() => Transaction, { onDelete: "CASCADE" })
  @JoinColumn({ name: "transaction_id" })
  transaction?: Transaction;

  @ApiProperty({ example: "grocery-receipt.jpg" })
  @Column({ type: "varchar", length: 255 })
  filename: string;

  @ApiProperty({
    example: "image/jpeg",
    description: "Server-sniffed MIME type",
  })
  @Column({ type: "varchar", name: "content_type", length: 100 })
  contentType: string;

  @ApiProperty({ example: 154213, description: "File size in bytes" })
  @Column({
    type: "bigint",
    name: "byte_size",
    transformer: bigintTransformer(),
  })
  byteSize: number;

  @ApiProperty({ description: "SHA-256 hex digest of the original bytes" })
  @Column({ type: "char", length: 64 })
  sha256: string;

  @ApiProperty({ example: "database" })
  @Column({
    type: "varchar",
    name: "storage_provider",
    length: 20,
    default: "database",
  })
  storageProvider: string;

  @ApiProperty({ description: "Opaque handle the storage provider resolves" })
  @Column({ type: "varchar", name: "storage_key", length: 512 })
  storageKey: string;

  @ApiProperty()
  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}

/**
 * BIGINT columns come back from the pg driver as strings; convert to number so
 * byteSize is a plain JS number in API responses and Content-Length math.
 */
function bigintTransformer() {
  return {
    to: (value: number | null): number | null => value,
    from: (value: string | null): number | null =>
      value === null ? null : Number(value),
  };
}
