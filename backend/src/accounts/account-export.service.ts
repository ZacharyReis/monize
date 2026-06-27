import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction } from "../transactions/entities/transaction.entity";
import { Category } from "../categories/entities/category.entity";
import { Account, AccountType } from "./entities/account.entity";
import { AccountsService } from "./accounts.service";
import { roundMoney } from "../common/round.util";

interface ExportTransaction {
  date: string;
  referenceNumber: string;
  payeeName: string;
  categoryPath: string;
  description: string;
  amount: number;
  status: string;
  runningBalance: number;
  isSplit: boolean;
  isTransfer: boolean;
  transferAccountName: string;
  splits: ExportSplit[];
}

interface ExportSplit {
  categoryPath: string;
  memo: string;
  amount: number;
  isTransfer: boolean;
  transferAccountName: string;
}

interface CsvExportOptions {
  expandSplits?: boolean;
  dateFormat?: string;
}

interface QifExportOptions {
  dateFormat?: string;
}

@Injectable()
export class AccountExportService {
  private readonly logger = new Logger(AccountExportService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,
    @InjectRepository(Category)
    private categoriesRepository: Repository<Category>,
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    private accountsService: AccountsService,
  ) {}

  async exportCsv(
    userId: string,
    accountId: string,
    options: CsvExportOptions = {},
  ): Promise<string> {
    const { expandSplits = true, dateFormat = "YYYY-MM-DD" } = options;
    const account = await this.accountsService.findOne(userId, accountId);
    const transactions = await this.getExportTransactions(userId, accountId);

    const rows: string[] = [];
    rows.push(this.csvHeader());

    let runningBalance = Number(account.openingBalance) || 0;

    for (const tx of transactions) {
      if (tx.status !== "VOID") {
        runningBalance = roundMoney(runningBalance + tx.amount);
      }
      const balance = tx.status === "VOID" ? runningBalance : runningBalance;

      if (tx.isSplit && expandSplits) {
        rows.push(
          this.csvRow(
            this.formatExportDate(tx.date, dateFormat),
            tx.referenceNumber,
            tx.payeeName,
            "-- Split --",
            tx.description,
            tx.amount,
            tx.status,
            balance,
          ),
        );
        for (const split of tx.splits) {
          const categoryLabel = split.isTransfer
            ? `Transfer: ${split.transferAccountName}`
            : split.categoryPath;
          rows.push(
            this.csvRow(
              "",
              "",
              "",
              categoryLabel,
              split.memo,
              split.amount,
              "",
              null,
            ),
          );
        }
      } else {
        const categoryLabel = tx.isTransfer
          ? `Transfer: ${tx.transferAccountName}`
          : tx.isSplit
            ? "-- Split --"
            : tx.categoryPath;
        rows.push(
          this.csvRow(
            this.formatExportDate(tx.date, dateFormat),
            tx.referenceNumber,
            tx.payeeName,
            categoryLabel,
            tx.description,
            tx.amount,
            tx.status,
            balance,
          ),
        );
      }
    }

    return rows.join("\n");
  }

  async exportQif(
    userId: string,
    accountId: string,
    options: QifExportOptions = {},
  ): Promise<string> {
    const { dateFormat = "M/D/YYYY" } = options;
    const account = await this.accountsService.findOne(userId, accountId);
    const transactions = await this.getExportTransactions(userId, accountId);

    const lines: string[] = [];
    lines.push(`!Type:${this.accountTypeToQif(account.accountType)}`);

    for (const tx of transactions) {
      lines.push(`D${this.formatExportDate(tx.date, dateFormat)}`);
      lines.push(`T${tx.amount}`);

      if (tx.payeeName) {
        lines.push(`P${tx.payeeName}`);
      }

      if (tx.description) {
        lines.push(`M${tx.description}`);
      }

      if (tx.referenceNumber) {
        lines.push(`N${tx.referenceNumber}`);
      }

      if (tx.status === "CLEARED") {
        lines.push("C*");
      } else if (tx.status === "RECONCILED") {
        lines.push("CX");
      }

      if (tx.isSplit) {
        for (const split of tx.splits) {
          if (split.isTransfer) {
            lines.push(`S[${split.transferAccountName}]`);
          } else {
            lines.push(`S${split.categoryPath}`);
          }
          if (split.memo) {
            lines.push(`E${split.memo}`);
          }
          lines.push(`$${split.amount}`);
        }
      } else if (tx.isTransfer) {
        lines.push(`L[${tx.transferAccountName}]`);
      } else if (tx.categoryPath) {
        lines.push(`L${tx.categoryPath}`);
      }

      lines.push("^");
    }

    return lines.join("\n");
  }

  private async getExportTransactions(
    userId: string,
    accountId: string,
  ): Promise<ExportTransaction[]> {
    const rawTransactions = await this.transactionsRepository
      .createQueryBuilder("transaction")
      .leftJoinAndSelect("transaction.payee", "payee")
      .leftJoinAndSelect("transaction.category", "category")
      .leftJoinAndSelect("transaction.splits", "splits")
      .leftJoinAndSelect("splits.category", "splitCategory")
      .leftJoinAndSelect("splits.transferAccount", "splitTransferAccount")
      .leftJoinAndSelect("transaction.linkedTransaction", "linkedTransaction")
      .leftJoinAndSelect("linkedTransaction.account", "linkedAccount")
      .where("transaction.userId = :userId", { userId })
      .andWhere("transaction.accountId = :accountId", { accountId })
      .orderBy("transaction.transactionDate", "ASC")
      .addOrderBy("transaction.createdAt", "ASC")
      .addOrderBy("transaction.id", "ASC")
      .getMany();

    const categoryMap = await this.buildCategoryPathMap(userId);

    return rawTransactions.map((tx) => ({
      date: tx.transactionDate,
      referenceNumber: tx.referenceNumber || "",
      payeeName: tx.payeeName || tx.payee?.name || "",
      categoryPath: tx.categoryId
        ? categoryMap.get(tx.categoryId) || tx.category?.name || ""
        : "",
      description: tx.description || "",
      amount: Number(tx.amount),
      status: tx.status,
      runningBalance: 0,
      isSplit: tx.isSplit,
      isTransfer: tx.isTransfer,
      transferAccountName: tx.linkedTransaction?.account?.name || "",
      splits: (tx.splits || []).map((split) => ({
        categoryPath: split.categoryId
          ? categoryMap.get(split.categoryId) || split.category?.name || ""
          : "",
        memo: split.memo || "",
        amount: Number(split.amount),
        isTransfer: !!split.transferAccountId,
        transferAccountName: split.transferAccount?.name || "",
      })),
    }));
  }

  private async buildCategoryPathMap(
    userId: string,
  ): Promise<Map<string, string>> {
    const categories = await this.categoriesRepository.find({
      where: { userId },
    });

    const map = new Map<string, Category>();
    for (const cat of categories) {
      map.set(cat.id, cat);
    }

    const pathMap = new Map<string, string>();
    for (const cat of categories) {
      const parts: string[] = [];
      let current: Category | undefined = cat;
      while (current) {
        parts.unshift(current.name);
        current = current.parentId ? map.get(current.parentId) : undefined;
      }
      pathMap.set(cat.id, parts.join(":"));
    }

    return pathMap;
  }

  private csvHeader(): string {
    return [
      "Date",
      "Reference Number",
      "Payee",
      "Category",
      "Description",
      "Amount",
      "Status",
      "Running Balance",
    ].join(",");
  }

  private csvRow(
    date: string,
    referenceNumber: string,
    payee: string,
    category: string,
    description: string,
    amount: number,
    status: string,
    runningBalance: number | null,
  ): string {
    return [
      this.escapeCsv(date),
      this.escapeCsv(referenceNumber),
      this.escapeCsv(payee),
      this.escapeCsv(category),
      this.escapeCsv(description),
      amount.toString(),
      this.escapeCsv(status),
      runningBalance !== null ? runningBalance.toString() : "",
    ].join(",");
  }

  private escapeCsv(value: string): string {
    // Guard against CSV formula injection: prefix with single quote if the
    // value starts with a character that spreadsheets interpret as a formula.
    // Coerce to string defensively: this method receives values that may
    // originate from HTTP query params where duplicated keys parse to arrays
    // (CWE-843); String() normalizes any non-string into a safe scalar before
    // applying string-only sanitization.
    let safe = typeof value === "string" ? value : String(value);
    if (/^[=+\-@\t\r]/.test(safe)) {
      safe = `'${safe}`;
    }

    if (
      safe.includes(",") ||
      safe.includes('"') ||
      safe.includes("\n") ||
      safe.includes("\r")
    ) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  }

  private accountTypeToQif(accountType: AccountType): string {
    switch (accountType) {
      case AccountType.CHEQUING:
      case AccountType.SAVINGS:
        return "Bank";
      case AccountType.CASH:
        return "Cash";
      case AccountType.CREDIT_CARD:
        return "CCard";
      case AccountType.INVESTMENT:
        return "Invst";
      case AccountType.ASSET:
        return "Oth A";
      case AccountType.LINE_OF_CREDIT:
      case AccountType.LOAN:
      case AccountType.MORTGAGE:
        return "Oth L";
      default:
        return "Bank";
    }
  }

  private formatExportDate(dateStr: string, format: string): string {
    const parts = dateStr.split("-");
    if (parts.length !== 3) {
      return dateStr;
    }

    const [yearStr, monthStr, dayStr] = parts;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const monthPadded = monthStr;
    const dayPadded = dayStr;

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthName = monthNames[month - 1] || "Jan";

    switch (format) {
      case "YYYY-MM-DD":
        return `${yearStr}-${monthPadded}-${dayPadded}`;
      case "MM/DD/YYYY":
        return `${monthPadded}/${dayPadded}/${yearStr}`;
      case "DD/MM/YYYY":
        return `${dayPadded}/${monthPadded}/${yearStr}`;
      case "DD-MMM-YYYY":
        return `${dayPadded}-${monthName}-${yearStr}`;
      case "M/D/YYYY":
        return `${month}/${day}/${year}`;
      default: {
        // Custom format: token replacement using placeholders to avoid
        // collisions (e.g. "D" matching the "D" in month name "Dec").
        // Process longest tokens first within each letter group.
        const tokens: Array<[string, string]> = [
          ["YYYY", yearStr],
          ["YY", yearStr.slice(2)],
          ["MMM", monthName],
          ["MM", monthPadded],
          ["M", String(month)],
          ["DD", dayPadded],
          ["D", String(day)],
        ];

        // Replace tokens with indexed placeholders, then resolve
        const placeholders: string[] = [];
        let result = format;
        for (const [token] of tokens) {
          const placeholder = `{${placeholders.length}}`;
          placeholders.push(placeholder);
          result = result.split(token).join(placeholder);
        }
        for (let i = 0; i < tokens.length; i++) {
          result = result.split(`{${i}}`).join(tokens[i][1]);
        }
        return result;
      }
    }
  }
}
