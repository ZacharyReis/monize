import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from "typeorm";

export type ImportMatchState = "pending" | "merged" | "kept";

@Entity("import_match_candidate")
export class ImportMatchCandidate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @Column({ type: "uuid", name: "account_id" })
  accountId: string;

  @Column({ type: "uuid", name: "import_batch_id" })
  importBatchId: string;

  @Column({ type: "decimal", precision: 20, scale: 4, name: "bank_amount" })
  bankAmount: number;

  @Column({ type: "date", name: "bank_date" })
  bankDate: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  fitid: string | null;

  @Column({ type: "varchar", length: 255, name: "bank_name", nullable: true })
  bankName: string | null;

  @Column({ type: "text", name: "bank_memo", nullable: true })
  bankMemo: string | null;

  @Column({ type: "varchar", length: 100, name: "bank_reference", nullable: true })
  bankReference: string | null;

  @Column({ type: "jsonb", name: "candidate_transaction_ids", default: () => "'[]'" })
  candidateTransactionIds: string[];

  @Column({ type: "varchar", length: 20, default: "pending" })
  state: ImportMatchState;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
