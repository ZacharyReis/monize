import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { Account } from "../../accounts/entities/account.entity";
import { Security } from "./security.entity";

/**
 * Holdings intentionally have no `user_id` column. Every other tenant table
 * in this schema carries `user_id` and a `idx_*_user` index, but holdings
 * are scoped exclusively via their owning account: deleting a user cascades
 * through accounts -> holdings, and every query joins holdings to accounts
 * (or `investment_transactions`) to filter by user. Adding a denormalized
 * `user_id` would speed up nothing the current callers do and would
 * introduce a second source of truth that has to be kept in sync.
 */
@Entity("holdings")
@Unique(["accountId", "securityId"])
export class Holding {
  @ApiProperty()
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty()
  @Column({ type: "uuid", name: "account_id" })
  accountId: string;

  @ApiProperty()
  @Column({ type: "uuid", name: "security_id" })
  securityId: string;

  @ApiProperty({ example: 100, description: "Number of shares/units held" })
  @Column({ type: "decimal", precision: 20, scale: 8, default: 0 })
  quantity: number;

  @ApiProperty({ example: 150.25, description: "Average cost per share" })
  @Column({
    type: "decimal",
    precision: 20,
    scale: 6,
    name: "average_cost",
    nullable: true,
  })
  averageCost: number;

  @ManyToOne(() => Account)
  @JoinColumn({ name: "account_id" })
  account: Account;

  @ManyToOne(() => Security)
  @JoinColumn({ name: "security_id" })
  security: Security;

  @ApiProperty()
  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
