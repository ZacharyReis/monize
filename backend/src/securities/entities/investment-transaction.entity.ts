import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { Account } from "../../accounts/entities/account.entity";
import { Transaction } from "../../transactions/entities/transaction.entity";
import { TransactionSplit } from "../../transactions/entities/transaction-split.entity";
import { Security } from "./security.entity";
import { User } from "../../users/entities/user.entity";

const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

export enum InvestmentAction {
  BUY = "BUY",
  SELL = "SELL",
  DIVIDEND = "DIVIDEND",
  INTEREST = "INTEREST",
  CAPITAL_GAIN = "CAPITAL_GAIN",
  SPLIT = "SPLIT",
  TRANSFER_IN = "TRANSFER_IN",
  TRANSFER_OUT = "TRANSFER_OUT",
  REINVEST = "REINVEST",
  ADD_SHARES = "ADD_SHARES",
  REMOVE_SHARES = "REMOVE_SHARES",
}

@Entity("investment_transactions")
export class InvestmentTransaction {
  @ApiProperty()
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty()
  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;

  @ApiProperty()
  @Column({ type: "uuid", name: "account_id" })
  accountId: string;

  @ApiProperty({ required: false })
  @Column({ type: "uuid", name: "transaction_id", nullable: true })
  transactionId: string | null;

  @ApiProperty({
    required: false,
    description:
      "When set, this investment transaction is embedded inside a split transaction; the split's amount is the cash impact and no separate linked cash transaction is created.",
  })
  @Column({ type: "uuid", name: "transaction_split_id", nullable: true })
  transactionSplitId: string | null;

  @ApiProperty({
    required: false,
    description:
      "When set, links the two legs of a security transfer (TRANSFER_OUT <-> TRANSFER_IN). Editing or deleting one leg cascades to the other.",
  })
  @Column({ type: "uuid", name: "linked_transaction_id", nullable: true })
  linkedTransactionId: string | null;

  @ApiProperty({ required: false })
  @Column({ type: "uuid", name: "security_id", nullable: true })
  securityId: string | null;

  @ApiProperty({
    required: false,
    description: "Account where funds come from (BUY) or go to (SELL)",
  })
  @Column({ type: "uuid", name: "funding_account_id", nullable: true })
  fundingAccountId: string | null;

  @ApiProperty({ enum: InvestmentAction })
  @Column({ type: "varchar", length: 50 })
  action: InvestmentAction;

  @ApiProperty()
  @Column({
    type: "date",
    name: "transaction_date",
    transformer: {
      from: (value: string | Date): string => {
        if (!value) return value as string;
        if (typeof value === "string") return value;
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      },
      to: (value: string | Date): string | Date => value,
    },
  })
  transactionDate: string;

  @ApiProperty({ example: 100, description: "Number of shares" })
  @Column({
    type: "decimal",
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  quantity: number | null;

  @ApiProperty({ example: 150.25, description: "Price per share" })
  @Column({
    type: "decimal",
    precision: 20,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  price: number | null;

  @ApiProperty({ example: 9.99, description: "Commission or fee" })
  @Column({
    type: "decimal",
    precision: 20,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  commission: number;

  @ApiProperty({
    example: 15035.99,
    description: "Total amount of transaction in the security's currency",
  })
  @Column({
    type: "decimal",
    precision: 20,
    scale: 4,
    name: "total_amount",
    transformer: numericTransformer,
  })
  totalAmount: number;

  @ApiProperty({
    example: 1.365,
    description:
      "Exchange rate used to convert the total amount from the security's currency into the cash account's currency. Defaults to 1 when both currencies match.",
  })
  @Column({
    type: "decimal",
    precision: 20,
    scale: 10,
    name: "exchange_rate",
    default: 1,
    transformer: {
      to: (value: number | null | undefined): number =>
        value === null || value === undefined ? 1 : value,
      from: (value: string | null): number =>
        value === null ? 1 : Number(value),
    },
  })
  exchangeRate: number;

  @ApiProperty({ required: false })
  @Column({ type: "text", nullable: true })
  description: string | null;

  @ManyToOne(() => Account)
  @JoinColumn({ name: "account_id" })
  account: Account;

  @ManyToOne(() => Transaction, { nullable: true })
  @JoinColumn({ name: "transaction_id" })
  transaction: Transaction;

  @OneToOne(() => TransactionSplit, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "transaction_split_id" })
  transactionSplit: TransactionSplit | null;

  @ManyToOne(() => Security, { nullable: true })
  @JoinColumn({ name: "security_id" })
  security: Security;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: "funding_account_id" })
  fundingAccount: Account | null;

  @ApiProperty()
  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
