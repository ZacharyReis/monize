import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

/** How report rows are grouped. */
export enum InvestmentGroupBy {
  NONE = "NONE",
  ACCOUNT = "ACCOUNT",
  SYMBOL = "SYMBOL",
  CURRENCY = "CURRENCY",
}

export enum InvestmentSortDirection {
  ASC = "ASC",
  DESC = "DESC",
}

/**
 * Saved configuration for an investment report. The selected columns are
 * stored in display order (the array order doubles as the column ordering),
 * always starting with "symbol".
 */
export interface InvestmentReportConfig {
  /** Ordered column keys to display (always includes "symbol"). */
  columns: string[];
  /** Holdings accounts to include. Empty array means all investment accounts. */
  accountIds: string[];
  /** Column key to sort by, or null to keep the natural (grouped) order. */
  sortColumn: string | null;
  /** Sort direction applied to sortColumn. */
  sortDirection: InvestmentSortDirection;
  /**
   * The "as of" date (YYYY-MM-DD) the report is valued at, or null to use the
   * latest day the markets were open at run time.
   */
  asOfDate: string | null;
  /**
   * When grouping by something other than account, combine a security held in
   * several accounts into one row instead of listing each account separately.
   */
  mergeAccounts?: boolean;
}

@Entity("investment_reports")
export class InvestmentReport {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  icon: string | null;

  @Column({
    type: "varchar",
    name: "background_color",
    length: 7,
    nullable: true,
  })
  backgroundColor: string | null;

  @Column({
    type: "varchar",
    length: 20,
    name: "group_by",
    default: InvestmentGroupBy.NONE,
  })
  groupBy: InvestmentGroupBy;

  @Column({ type: "jsonb", default: "{}" })
  config: InvestmentReportConfig;

  @Column({ name: "is_favourite", default: false })
  isFavourite: boolean;

  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
