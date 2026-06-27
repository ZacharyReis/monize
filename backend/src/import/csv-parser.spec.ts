import {
  validateCsvContent,
  parseCsvHeaders,
  parseCsv,
  detectTagSeparator,
  splitTagValue,
  normalizeReconciliationStatus,
  CsvColumnMappingConfig,
  CsvTransferRule,
} from "./csv-parser";

describe("CSV Parser", () => {
  describe("validateCsvContent", () => {
    it("returns invalid for empty content", () => {
      expect(validateCsvContent("")).toEqual({
        valid: false,
        error: "File is empty",
      });
    });

    it("returns invalid for whitespace-only content", () => {
      expect(validateCsvContent("   \n  ")).toEqual({
        valid: false,
        error: "File is empty",
      });
    });

    it("returns invalid for a single line", () => {
      expect(validateCsvContent("Date,Amount,Payee")).toEqual({
        valid: false,
        error:
          "CSV file must have at least 2 rows (header and data, or 2 data rows)",
      });
    });

    it("returns valid for content with at least 2 non-empty lines", () => {
      expect(
        validateCsvContent("Date,Amount,Payee\n01/15/2026,-50.00,Grocery"),
      ).toEqual({ valid: true });
    });

    it("returns valid for 2 data rows without a header", () => {
      expect(
        validateCsvContent("01/15/2026,-50.00\n01/16/2026,-30.00"),
      ).toEqual({ valid: true });
    });
  });

  describe("parseCsvHeaders", () => {
    it("parses headers with comma delimiter", () => {
      const csv = "Date,Amount,Payee\n01/15/2026,-50.00,Grocery\n";
      const result = parseCsvHeaders(csv, ",");
      expect(result.headers).toEqual(["Date", "Amount", "Payee"]);
      expect(result.sampleRows).toHaveLength(1);
      expect(result.rowCount).toBe(1);
    });

    it("parses headers with semicolon delimiter", () => {
      const csv = "Date;Amount;Payee\n01/15/2026;-50.00;Grocery\n";
      const result = parseCsvHeaders(csv, ";");
      expect(result.headers).toEqual(["Date", "Amount", "Payee"]);
      expect(result.sampleRows).toHaveLength(1);
    });

    it("parses headers with tab delimiter", () => {
      const csv = "Date\tAmount\tPayee\n01/15/2026\t-50.00\tGrocery\n";
      const result = parseCsvHeaders(csv, "\t");
      expect(result.headers).toEqual(["Date", "Amount", "Payee"]);
      expect(result.sampleRows).toHaveLength(1);
    });

    it("auto-detects comma delimiter", () => {
      const csv =
        "Date,Amount,Payee\n01/15/2026,-50.00,Grocery\n01/16/2026,-30.00,Store\n";
      const result = parseCsvHeaders(csv);
      expect(result.headers).toEqual(["Date", "Amount", "Payee"]);
      expect(result.rowCount).toBe(2);
    });

    it("auto-detects semicolon delimiter", () => {
      const csv =
        "Date;Amount;Payee\n01/15/2026;-50.00;Grocery\n01/16/2026;-30.00;Store\n";
      const result = parseCsvHeaders(csv);
      expect(result.headers).toEqual(["Date", "Amount", "Payee"]);
    });

    it("auto-detects tab delimiter", () => {
      const csv =
        "Date\tAmount\tPayee\n01/15/2026\t-50.00\tGrocery\n01/16/2026\t-30.00\tStore\n";
      const result = parseCsvHeaders(csv);
      expect(result.headers).toEqual(["Date", "Amount", "Payee"]);
    });

    it("returns up to 5 sample rows", () => {
      const lines = ["H1,H2"];
      for (let i = 0; i < 10; i++) {
        lines.push(`a${i},b${i}`);
      }
      const result = parseCsvHeaders(lines.join("\n"));
      expect(result.sampleRows).toHaveLength(5);
      expect(result.rowCount).toBe(10);
    });

    it("returns empty results for empty content", () => {
      const result = parseCsvHeaders("");
      expect(result.headers).toEqual([]);
      expect(result.sampleRows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });

    it("auto-detects a delimiter with inconsistent column counts", () => {
      // Comma appears in every line but with differing counts, so detection
      // falls through the "consistent" check to the most-present candidate.
      const csv = "A,B,C\nd,e\nf,g,h,i\n";
      const result = parseCsvHeaders(csv);
      expect(result.headers).toEqual(["A", "B", "C"]);
    });

    it("ignores delimiters inside quoted fields during auto-detection", () => {
      const csv = '"Name","Amount"\n"Smith, John",100\n';
      const result = parseCsvHeaders(csv);
      expect(result.headers).toEqual(["Name", "Amount"]);
      expect(result.sampleRows[0]).toEqual(["Smith, John", "100"]);
    });
  });

  describe("parseCsv", () => {
    function baseConfig(
      overrides?: Partial<CsvColumnMappingConfig>,
    ): CsvColumnMappingConfig {
      return {
        date: 0,
        amount: 1,
        payee: 2,
        dateFormat: "MM/DD/YYYY",
        hasHeader: true,
        delimiter: ",",
        ...overrides,
      };
    }

    describe("basic parsing", () => {
      it("parses a basic CSV with comma delimiter", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-50.00,Grocery Store\n01/16/2026,2500.00,Employer\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(2);
        expect(result.transactions[0].date).toBe("2026-01-15");
        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[0].payee).toBe("Grocery Store");
        expect(result.transactions[1].date).toBe("2026-01-16");
        expect(result.transactions[1].amount).toBe(2500);
        expect(result.transactions[1].payee).toBe("Employer");
      });

      it("parses CSV with semicolon delimiter", () => {
        const csv = "Date;Amount;Payee\n01/15/2026;-50.00;Grocery Store\n";
        const result = parseCsv(csv, baseConfig({ delimiter: ";" }));

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[0].payee).toBe("Grocery Store");
      });

      it("parses CSV with tab delimiter", () => {
        const csv = "Date\tAmount\tPayee\n01/15/2026\t-50.00\tGrocery Store\n";
        const result = parseCsv(csv, baseConfig({ delimiter: "\t" }));

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[0].payee).toBe("Grocery Store");
      });

      it("parses CSV without header row", () => {
        const csv = "01/15/2026,-50.00,Grocery Store\n";
        const result = parseCsv(csv, baseConfig({ hasHeader: false }));

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-15");
        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[0].payee).toBe("Grocery Store");
      });

      it("returns empty result for empty content", () => {
        const result = parseCsv("", baseConfig());
        expect(result.transactions).toEqual([]);
        expect(result.categories).toEqual([]);
        expect(result.transferAccounts).toEqual([]);
        expect(result.accountType).toBe("CHEQUING");
        expect(result.openingBalance).toBeNull();
        expect(result.openingBalanceDate).toBeNull();
      });
    });

    describe("amount columns", () => {
      it("uses single amount column", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-75.50,Store\n01/16/2026,100.00,Deposit\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].amount).toBe(-75.5);
        expect(result.transactions[1].amount).toBe(100);
      });

      it("uses separate debit and credit columns", () => {
        const csv =
          "Date,Debit,Credit,Payee\n01/15/2026,50.00,,Store\n01/16/2026,,100.00,Deposit\n";
        const config = baseConfig({
          amount: undefined,
          debit: 1,
          credit: 2,
          payee: 3,
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[1].amount).toBe(100);
      });

      it("negates debit values regardless of sign", () => {
        const csv =
          "Date,Debit,Credit\n01/15/2026,-50.00,\n01/16/2026,75.00,\n";
        const config = baseConfig({
          amount: undefined,
          debit: 1,
          credit: 2,
        });
        const result = parseCsv(csv, config);

        // Both should be negative since debits are outflows
        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[1].amount).toBe(-75);
      });

      it("treats credit as positive regardless of sign", () => {
        const csv = "Date,Debit,Credit\n01/15/2026,,200.00\n";
        const config = baseConfig({
          amount: undefined,
          debit: 1,
          credit: 2,
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(200);
      });

      it("reverses sign for single amount column when reverseSign is true", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,75.50,Store\n01/16/2026,-100.00,Refund\n";
        const config = baseConfig({ reverseSign: true });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(-75.5);
        expect(result.transactions[1].amount).toBe(100);
      });

      it("does not reverse sign when reverseSign is false", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,75.50,Store\n";
        const config = baseConfig({ reverseSign: false });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(75.5);
      });

      it("does not reverse sign for split debit/credit columns", () => {
        const csv =
          "Date,Debit,Credit,Payee\n01/15/2026,50.00,,Store\n01/16/2026,,100.00,Deposit\n";
        const config = baseConfig({
          amount: undefined,
          debit: 1,
          credit: 2,
          payee: 3,
          reverseSign: true,
        });
        const result = parseCsv(csv, config);

        // reverseSign only applies to single amount mode
        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[1].amount).toBe(100);
      });

      it("uses a debit-only column (no credit mapping)", () => {
        const csv = "Date,Debit,Payee\n01/15/2026,50.00,Store\n";
        const config = baseConfig({
          amount: undefined,
          debit: 1,
          credit: undefined,
          payee: 2,
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(-50);
      });

      it("uses a credit-only column (no debit mapping)", () => {
        const csv = "Date,Credit,Payee\n01/15/2026,100.00,Deposit\n";
        const config = baseConfig({
          amount: undefined,
          debit: undefined,
          credit: 1,
          payee: 2,
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(100);
      });
    });

    describe("date format parsing", () => {
      it("parses MM/DD/YYYY format", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "MM/DD/YYYY" }));
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("parses DD/MM/YYYY format", () => {
        const csv = "Date,Amount\n15/01/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "DD/MM/YYYY" }));
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("parses YYYY-MM-DD format", () => {
        const csv = "Date,Amount\n2026-01-15,-50.00\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "YYYY-MM-DD" }));
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("parses YYYY-DD-MM format", () => {
        const csv = "Date,Amount\n2026-15-01,-50.00\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "YYYY-DD-MM" }));
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("handles 2-digit year (>50 = 19xx)", () => {
        const csv = "Date,Amount\n01/15/99,-50.00\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "MM/DD/YYYY" }));
        expect(result.transactions[0].date).toBe("1999-01-15");
      });

      it("handles 2-digit year (<=50 = 20xx)", () => {
        const csv = "Date,Amount\n01/15/26,-50.00\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "MM/DD/YYYY" }));
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("returns sample dates (up to 3 unique)", () => {
        const csv =
          "Date,Amount\n01/15/2026,-50.00\n01/16/2026,-30.00\n01/17/2026,-20.00\n01/18/2026,-10.00\n";
        const result = parseCsv(csv, baseConfig());
        expect(result.sampleDates).toHaveLength(3);
        expect(result.sampleDates).toEqual([
          "01/15/2026",
          "01/16/2026",
          "01/17/2026",
        ]);
      });

      it("deduplicates sample dates", () => {
        const csv =
          "Date,Amount\n01/15/2026,-50.00\n01/15/2026,-30.00\n01/16/2026,-20.00\n";
        const result = parseCsv(csv, baseConfig());
        expect(result.sampleDates).toEqual(["01/15/2026", "01/16/2026"]);
      });
    });

    describe("transfer rules", () => {
      it("matches transfer by payee pattern", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-500.00,Transfer to Savings\n";
        const rules: CsvTransferRule[] = [
          {
            type: "payee",
            pattern: "Transfer to Savings",
            accountName: "Savings Account",
          },
        ];
        const result = parseCsv(csv, baseConfig(), rules);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("Savings Account");
        expect(result.transactions[0].category).toBe("");
      });

      it("matches transfer by category pattern", () => {
        const csv =
          "Date,Amount,Payee,Category\n01/15/2026,-500.00,Bank,[Savings]\n";
        const config = baseConfig({ category: 3 });
        const rules: CsvTransferRule[] = [
          {
            type: "category",
            pattern: "[Savings]",
            accountName: "Savings Account",
          },
        ];
        const result = parseCsv(csv, config, rules);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("Savings Account");
        expect(result.transactions[0].category).toBe("");
      });

      it("uses case-insensitive contains matching", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-500.00,TRANSFER TO SAVINGS ACCOUNT\n";
        const rules: CsvTransferRule[] = [
          {
            type: "payee",
            pattern: "transfer to savings",
            accountName: "Savings",
          },
        ];
        const result = parseCsv(csv, baseConfig(), rules);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("Savings");
      });

      it("matches partial payee value (contains)", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-200.00,Interac e-Transfer to John\n";
        const rules: CsvTransferRule[] = [
          { type: "payee", pattern: "e-Transfer", accountName: "John Account" },
        ];
        const result = parseCsv(csv, baseConfig(), rules);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("John Account");
      });

      it("collects transfer accounts sorted", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-500.00,Xfer Savings\n01/16/2026,-200.00,Xfer Checking\n01/17/2026,-100.00,Xfer Savings\n";
        const rules: CsvTransferRule[] = [
          { type: "payee", pattern: "Xfer Savings", accountName: "Savings" },
          { type: "payee", pattern: "Xfer Checking", accountName: "Checking" },
        ];
        const result = parseCsv(csv, baseConfig(), rules);

        expect(result.transferAccounts).toEqual(["Checking", "Savings"]);
      });

      it("does not create transfer when no rules match", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,-50.00,Grocery Store\n";
        const rules: CsvTransferRule[] = [
          { type: "payee", pattern: "Transfer", accountName: "Savings" },
        ];
        const result = parseCsv(csv, baseConfig(), rules);

        expect(result.transactions[0].isTransfer).toBe(false);
        expect(result.transactions[0].transferAccount).toBe("");
      });
    });

    describe("quoted fields", () => {
      it("handles quoted fields with commas inside", () => {
        const csv = 'Date,Amount,Payee\n01/15/2026,-50.00,"Smith, John"\n';
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].payee).toBe("Smith, John");
      });

      it("handles escaped double quotes inside quoted fields", () => {
        const csv =
          'Date,Amount,Payee\n01/15/2026,-50.00,"The ""Best"" Store"\n';
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].payee).toBe('The "Best" Store');
      });

      it("handles quoted fields with newlines inside", () => {
        const csv = 'Date,Amount,Memo\n01/15/2026,-50.00,"Line 1\nLine 2"\n';
        const config = baseConfig({ memo: 2, payee: undefined });
        const result = parseCsv(csv, config);

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].memo).toBe("Line 1\nLine 2");
      });
    });

    describe("empty optional fields", () => {
      it("handles missing payee", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,-50.00,\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].payee).toBe("");
      });

      it("handles missing memo and category", () => {
        const csv =
          "Date,Amount,Payee,Memo,Category\n01/15/2026,-50.00,Store,,\n";
        const config = baseConfig({ memo: 3, category: 4 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].memo).toBe("");
        expect(result.transactions[0].category).toBe("");
      });

      it("handles columns beyond row length gracefully", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const config = baseConfig({ payee: 5, memo: 6 });
        const result = parseCsv(csv, config);

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].payee).toBe("");
        expect(result.transactions[0].memo).toBe("");
      });
    });

    describe("HTML sanitization", () => {
      it("strips HTML angle brackets from payee", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-50.00,<script>alert(1)</script>\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].payee).toBe("scriptalert(1)/script");
      });

      it("converts all-caps payee to Proper Case", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-50.00,WALMART GROCERY STORE\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].payee).toBe("Walmart Grocery Store");
      });

      it("leaves mixed-case payee unchanged", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-50.00,McDonald's Restaurant\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].payee).toBe("McDonald's Restaurant");
      });

      it("converts all-caps payee with numbers and symbols", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-50.00,COSTCO #1234 - WAREHOUSE\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].payee).toBe("Costco #1234 - Warehouse");
      });

      it("strips HTML angle brackets from memo", () => {
        const csv =
          "Date,Amount,Payee,Memo\n01/15/2026,-50.00,Store,<img src=x onerror=alert(1)>\n";
        const config = baseConfig({ memo: 3 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].memo).toBe("img src=x onerror=alert(1)");
      });

      it("strips HTML angle brackets from category", () => {
        const csv =
          "Date,Amount,Payee,Category\n01/15/2026,-50.00,Store,<b>Food</b>\n";
        const config = baseConfig({ category: 3 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].category).toBe("bFood/b");
      });
    });

    describe("truncation of long values", () => {
      it("truncates payee to 255 characters", () => {
        const longPayee = "A".repeat(300);
        const csv = `Date,Amount,Payee\n01/15/2026,-50.00,${longPayee}\n`;
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].payee).toHaveLength(255);
      });

      it("truncates memo to 5000 characters", () => {
        const longMemo = "B".repeat(6000);
        const csv = `Date,Amount,Payee,Memo\n01/15/2026,-50.00,Store,${longMemo}\n`;
        const config = baseConfig({ memo: 3 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].memo).toHaveLength(5000);
      });

      it("truncates reference number to 100 characters", () => {
        const longRef = "C".repeat(150);
        const csv = `Date,Amount,Payee,Ref\n01/15/2026,-50.00,Store,${longRef}\n`;
        const config = baseConfig({ referenceNumber: 3 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].number).toHaveLength(100);
      });

      it("truncates category to 255 characters", () => {
        const longCategory = "D".repeat(300);
        const csv = `Date,Amount,Payee,Category\n01/15/2026,-50.00,Store,${longCategory}\n`;
        const config = baseConfig({ category: 3 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].category).toHaveLength(255);
      });
    });

    describe("dates with time components", () => {
      it("strips time after space (HH:MM:SS)", () => {
        const csv = "Date,Amount,Payee\n01/15/2026 14:30:00,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("strips time after space (H:MM AM/PM)", () => {
        const csv = "Date,Amount,Payee\n01/15/2026 2:30 PM,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("strips ISO 8601 time (T separator)", () => {
        const csv = "Date,Amount,Payee\n2026-01-15T12:00:00Z,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "YYYY-MM-DD" }));

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("strips time with timezone offset", () => {
        const csv =
          "Date,Amount,Payee\n2026-01-15T14:30:00+05:00,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "YYYY-MM-DD" }));

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("handles DD/MM/YYYY with time", () => {
        const csv = "Date,Amount,Payee\n15/01/2026 09:45,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "DD/MM/YYYY" }));

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("still parses dates without time normally", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-15");
      });
    });

    describe("unparseable dates", () => {
      it("skips rows with unparseable dates", () => {
        const csv =
          "Date,Amount,Payee\nJanuary 15 2026,-50.00,Store\n01/16/2026,-30.00,Shop\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].date).toBe("2026-01-16");
      });

      it("skips rows with empty date field", () => {
        const csv =
          "Date,Amount,Payee\n,-50.00,Store\n01/16/2026,-30.00,Shop\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].payee).toBe("Shop");
      });

      it("skips rows with invalid date ranges", () => {
        const csv =
          "Date,Amount,Payee\n13/32/2026,-50.00,Store\n01/15/2026,-30.00,Shop\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].payee).toBe("Shop");
      });

      it("skips a non-ISO date when the format expects YYYY-MM-DD", () => {
        const csv =
          "Date,Amount,Payee\n01/15/2026,-50.00,Store\n2026-01-16,-30.00,Shop\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "YYYY-MM-DD" }));

        // First row does not match the ISO regex and is skipped
        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].payee).toBe("Shop");
      });
    });

    describe("custom date format patterns", () => {
      it("parses a dotted DD.MM.YYYY custom pattern", () => {
        const csv = "Date,Amount,Payee\n15.01.2026,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "DD.MM.YYYY" }));

        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("resolves a 2-digit year in a custom YY/MM/DD pattern (20xx)", () => {
        const csv = "Date,Amount,Payee\n26/01/15,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "YY/MM/DD" }));

        expect(result.transactions[0].date).toBe("2026-01-15");
      });

      it("resolves a 2-digit year above 50 to the 1900s", () => {
        const csv = "Date,Amount,Payee\n75/01/15,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "YY/MM/DD" }));

        expect(result.transactions[0].date).toBe("1975-01-15");
      });

      it("skips a row when a custom pattern does not match", () => {
        const csv =
          "Date,Amount,Payee\nnot-a-date,-50.00,Store\n15.01.2026,-30.00,Shop\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "DD.MM.YYYY" }));

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].payee).toBe("Shop");
      });

      it("skips a row when a custom pattern lacks a required component", () => {
        // Pattern has no year token, so year stays empty and the date is null
        const csv = "Date,Amount,Payee\n01/15,-50.00,Store\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "MM/DD" }));

        expect(result.transactions).toHaveLength(0);
      });
    });

    describe("amount formatting", () => {
      it("handles currency symbol ($)", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,$1234.56,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].amount).toBe(1234.56);
      });

      it("handles currency symbol (pound)", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,\u00A31234.56,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].amount).toBe(1234.56);
      });

      it("handles currency symbol (euro)", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,\u20AC1234.56,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].amount).toBe(1234.56);
      });

      it("handles commas as thousands separators", () => {
        const csv = 'Date,Amount\n01/15/2026,"1,234.56"\n';
        const result = parseCsv(csv, baseConfig({ payee: undefined }));

        expect(result.transactions[0].amount).toBe(1234.56);
      });

      it("handles parentheses as negative notation", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,(50.00),Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].amount).toBe(-50);
      });

      it("handles negative amount with currency symbol", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,-$50.00,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].amount).toBe(-50);
      });

      it("treats empty amount as zero", () => {
        const csv = "Date,Amount,Payee\n01/15/2026,,Store\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].amount).toBe(0);
      });
    });

    describe("categories extraction", () => {
      it("collects unique categories sorted", () => {
        const csv =
          "Date,Amount,Payee,Category\n01/15/2026,-50.00,Store,Food\n01/16/2026,-30.00,Bus,Transport\n01/17/2026,-20.00,Market,Food\n";
        const config = baseConfig({ category: 3 });
        const result = parseCsv(csv, config);

        expect(result.categories).toEqual(["Food", "Transport"]);
      });

      it("does not include empty categories", () => {
        const csv =
          "Date,Amount,Payee,Category\n01/15/2026,-50.00,Store,Food\n01/16/2026,-30.00,Bus,\n";
        const config = baseConfig({ category: 3 });
        const result = parseCsv(csv, config);

        expect(result.categories).toEqual(["Food"]);
      });

      it("does not include category when transfer rule matches", () => {
        const csv =
          "Date,Amount,Payee,Category\n01/15/2026,-500.00,Xfer,Transfers\n01/16/2026,-30.00,Store,Food\n";
        const config = baseConfig({ category: 3 });
        const rules: CsvTransferRule[] = [
          {
            type: "category",
            pattern: "Transfers",
            accountName: "Savings",
          },
        ];
        const result = parseCsv(csv, config, rules);

        expect(result.categories).toEqual(["Food"]);
        expect(result.transferAccounts).toEqual(["Savings"]);
      });
    });

    describe("default result fields", () => {
      it("sets accountType to CHEQUING", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig());
        expect(result.accountType).toBe("CHEQUING");
      });

      it("sets accountName to empty string", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig());
        expect(result.accountName).toBe("");
      });

      it("sets securities to empty array", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig());
        expect(result.securities).toEqual([]);
      });

      it("uses the provided dateFormat as detectedDateFormat", () => {
        const csv = "Date,Amount\n15/01/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig({ dateFormat: "DD/MM/YYYY" }));
        expect(result.detectedDateFormat).toBe("DD/MM/YYYY");
      });

      it("sets openingBalance and openingBalanceDate to null", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig());
        expect(result.openingBalance).toBeNull();
        expect(result.openingBalanceDate).toBeNull();
      });
    });

    describe("transaction default fields", () => {
      it("sets cleared and reconciled to false", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions[0].cleared).toBe(false);
        expect(result.transactions[0].reconciled).toBe(false);
      });

      it("sets investment fields to defaults", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const result = parseCsv(csv, baseConfig());
        const tx = result.transactions[0];

        expect(tx.security).toBe("");
        expect(tx.action).toBe("");
        expect(tx.price).toBe(0);
        expect(tx.quantity).toBe(0);
        expect(tx.commission).toBe(0);
        expect(tx.splits).toEqual([]);
      });
    });

    describe("Windows-style line endings", () => {
      it("handles CRLF line endings", () => {
        const csv =
          "Date,Amount,Payee\r\n01/15/2026,-50.00,Store\r\n01/16/2026,-30.00,Shop\r\n";
        const result = parseCsv(csv, baseConfig());

        expect(result.transactions).toHaveLength(2);
        expect(result.transactions[0].payee).toBe("Store");
        expect(result.transactions[1].payee).toBe("Shop");
      });
    });

    describe("reference number mapping", () => {
      it("maps reference number column", () => {
        const csv = "Date,Amount,Payee,Ref\n01/15/2026,-50.00,Store,CHK1234\n";
        const config = baseConfig({ referenceNumber: 3 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].number).toBe("CHK1234");
      });
    });

    describe("subcategory mapping", () => {
      it("combines category and subcategory with colon separator", () => {
        const csv =
          "Date,Amount,Payee,Category,Subcategory\n01/15/2026,-50.00,Store,Food,Groceries\n";
        const config = baseConfig({ category: 3, subcategory: 4 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].category).toBe("Food:Groceries");
        expect(result.categories).toEqual(["Food:Groceries"]);
      });

      it("uses only category when subcategory is empty", () => {
        const csv =
          "Date,Amount,Payee,Category,Subcategory\n01/15/2026,-50.00,Store,Food,\n";
        const config = baseConfig({ category: 3, subcategory: 4 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].category).toBe("Food");
      });

      it("uses only subcategory when category is empty", () => {
        const csv =
          "Date,Amount,Payee,Category,Subcategory\n01/15/2026,-50.00,Store,,Groceries\n";
        const config = baseConfig({ category: 3, subcategory: 4 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].category).toBe("Groceries");
      });

      it("uses subcategory column without category column", () => {
        const csv =
          "Date,Amount,Payee,Subcategory\n01/15/2026,-50.00,Store,Groceries\n";
        const config = baseConfig({ subcategory: 3 });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].category).toBe("Groceries");
      });

      it("collects combined categories in category list", () => {
        const csv =
          "Date,Amount,Payee,Category,Subcategory\n01/15/2026,-50.00,Store,Food,Groceries\n01/16/2026,-30.00,Bus,Transport,Bus Fare\n01/17/2026,-20.00,Market,Food,Groceries\n";
        const config = baseConfig({ category: 3, subcategory: 4 });
        const result = parseCsv(csv, config);

        expect(result.categories).toEqual([
          "Food:Groceries",
          "Transport:Bus Fare",
        ]);
      });

      it("truncates an over-long combined category to the column limit", () => {
        const cat = "C".repeat(200);
        const sub = "S".repeat(200);
        const csv = `Date,Amount,Payee,Category,Subcategory\n01/15/2026,-50.00,Store,${cat},${sub}\n`;
        const config = baseConfig({ category: 3, subcategory: 4 });
        const result = parseCsv(csv, config);

        // CATEGORY limit is 255
        expect(result.transactions[0].category).toHaveLength(255);
      });
    });

    describe("amount type column", () => {
      const amountTypeCsv = [
        "Date,Account,Category,Subcategory,Note,USD,Income/Expense,Description",
        "03/09/2026,Chase,Bills,Cable,Verizon,189.17,Expense,",
        "03/06/2026,Chase,Salary,,My Company,650.23,Income,",
        "03/05/2026,Chase,Leisure,,YouTube,13.99,Expense,Premium",
        "09/23/2024,Chase,Cash,,ATM,200,Transfer-Out,",
        "09/04/2024,Chase,Freedom Unlimited,,Payment,2693.99,Transfer-Out,",
      ].join("\n");

      function amountTypeConfig(
        overrides?: Partial<CsvColumnMappingConfig>,
      ): CsvColumnMappingConfig {
        return {
          date: 0,
          amount: 5,
          payee: 4,
          category: 2,
          subcategory: 3,
          memo: 7,
          dateFormat: "MM/DD/YYYY",
          hasHeader: true,
          delimiter: ",",
          amountTypeColumn: 6,
          incomeValues: ["Income"],
          expenseValues: ["Expense"],
          transferOutValues: ["Transfer-Out"],
          ...overrides,
        };
      }

      it("negates amount for expense values", () => {
        const csv = "Date,Amount,Type\n01/15/2026,50.00,Expense\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(-50);
      });

      it("leaves amount unchanged for unrecognized values (not in any list)", () => {
        const csv = "Date,Amount,Type\n01/15/2026,650.23,Unknown\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(650.23);
      });

      it("leaves amount unchanged when the type column is empty", () => {
        const csv = "Date,Amount,Type\n01/15/2026,650.23,\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(650.23);
      });

      it("forces amount positive for income values", () => {
        const csv = "Date,Amount,Type\n01/15/2026,650.23,Income\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          incomeValues: ["Income"],
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(650.23);
      });

      it("keeps negative income amount negative (deduction/clawback)", () => {
        const csv = "Date,Amount,Type\n01/15/2026,-650.23,Income\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          incomeValues: ["Income"],
        });
        const result = parseCsv(csv, config);

        // Negative amount + Income = deduction/clawback, stays negative
        expect(result.transactions[0].amount).toBe(-650.23);
      });

      it("supports multiple income keywords", () => {
        const csv =
          "Date,Amount,Type\n01/15/2026,100.00,Income\n01/16/2026,200.00,Salary\n01/17/2026,300.00,Refund\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          incomeValues: ["Income", "Salary", "Refund"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(100);
        expect(result.transactions[1].amount).toBe(200);
        expect(result.transactions[2].amount).toBe(300);
      });

      it("detects transfer-out and uses category as transfer account", () => {
        const csv =
          "Date,Amount,Payee,Category,Type\n01/15/2026,500.00,ATM,Cash,Transfer-Out\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferOutValues: ["Transfer-Out"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("Cash");
        expect(result.transactions[0].amount).toBe(-500);
        expect(result.transactions[0].category).toBe("");
      });

      it("detects transfer-in and keeps amount positive", () => {
        const csv =
          "Date,Amount,Payee,Category,Type\n01/15/2026,500.00,ATM,Savings,Transfer-In\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferInValues: ["Transfer-In"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("Savings");
        expect(result.transactions[0].amount).toBe(500);
        expect(result.transactions[0].category).toBe("");
      });

      it("performs case-insensitive matching", () => {
        const csv = "Date,Amount,Type\n01/15/2026,50.00,expense\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(-50);
      });

      it("supports multiple expense keywords", () => {
        const csv =
          "Date,Amount,Type\n01/15/2026,50.00,Expense\n01/16/2026,30.00,Debit\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          expenseValues: ["Expense", "Debit"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].amount).toBe(-50);
        expect(result.transactions[1].amount).toBe(-30);
      });

      it("skips transfer detection when category is not mapped", () => {
        const csv = "Date,Amount,Type\n01/15/2026,200.00,Transfer-Out\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          transferOutValues: ["Transfer-Out"],
        });
        const result = parseCsv(csv, config);

        // No category mapped, so transfer detection via amountType is skipped
        expect(result.transactions[0].isTransfer).toBe(false);
        // Amount is unchanged since transfer-out didn't fire
        expect(result.transactions[0].amount).toBe(200);
      });

      it("prevents transfer rules from running when amountType detected transfer", () => {
        const csv =
          "Date,Amount,Payee,Category,Type\n01/15/2026,500.00,Payment,Freedom Unlimited,Transfer-Out\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferOutValues: ["Transfer-Out"],
        });
        const rules: CsvTransferRule[] = [
          {
            type: "payee",
            pattern: "Payment",
            accountName: "Override Account",
          },
        ];
        const result = parseCsv(csv, config, rules);

        // amountType transfer takes precedence, transfer rule is skipped
        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe(
          "Freedom Unlimited",
        );
      });

      it("collects transfer accounts from amountType detection", () => {
        const csv =
          "Date,Amount,Payee,Category,Type\n01/15/2026,200,ATM,Cash,Transfer-Out\n01/16/2026,500,Payment,Freedom Unlimited,Transfer-Out\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferOutValues: ["Transfer-Out"],
        });
        const result = parseCsv(csv, config);

        expect(result.transferAccounts).toEqual(["Cash", "Freedom Unlimited"]);
      });

      it("flips negative expense to positive (refund/reversal)", () => {
        const csv = "Date,Amount,Type\n01/15/2026,-50.00,Expense\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        // Negative amount + Expense = refund/reversal, stored as positive
        expect(result.transactions[0].amount).toBe(50);
      });

      it("considers original sign: negative expense becomes positive (refund)", () => {
        const csv = "Date,Amount,Type\n01/15/2026,-45.00,Expense\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        // Negative amount + Expense type = refund/reversal, stored as positive
        expect(result.transactions[0].amount).toBe(45);
      });

      it("considers original sign: negative income stays negative (deduction)", () => {
        const csv = "Date,Amount,Type\n01/15/2026,-200.00,Income\n";
        const config = baseConfig({
          amountTypeColumn: 2,
          incomeValues: ["Income"],
        });
        const result = parseCsv(csv, config);

        // Negative amount + Income type = deduction/clawback, stays negative
        expect(result.transactions[0].amount).toBe(-200);
      });

      it("works with reverseSign (amountType uses raw CSV sign, not reversed sign)", () => {
        const csv = "Date,Amount,Type\n01/15/2026,50.00,Expense\n";
        const config = baseConfig({
          reverseSign: true,
          amountTypeColumn: 2,
          expenseValues: ["Expense"],
        });
        const result = parseCsv(csv, config);

        // Raw CSV amount is positive 50, expense negates it to -50
        // reverseSign made amount -50 already, but amountType uses rawAmount (50) to decide sign
        expect(result.transactions[0].amount).toBe(-50);
      });

      it("handles the full user CSV scenario correctly", () => {
        const result = parseCsv(amountTypeCsv, amountTypeConfig());

        // Expense: negated
        expect(result.transactions[0].amount).toBe(-189.17);
        expect(result.transactions[0].isTransfer).toBe(false);
        expect(result.transactions[0].category).toBe("Bills:Cable");

        // Income: unchanged
        expect(result.transactions[1].amount).toBe(650.23);
        expect(result.transactions[1].isTransfer).toBe(false);
        expect(result.transactions[1].category).toBe("Salary");

        // Expense: negated
        expect(result.transactions[2].amount).toBe(-13.99);
        expect(result.transactions[2].isTransfer).toBe(false);

        // Transfer-Out: negated + transfer detected
        expect(result.transactions[3].amount).toBe(-200);
        expect(result.transactions[3].isTransfer).toBe(true);
        expect(result.transactions[3].transferAccount).toBe("Cash");
        expect(result.transactions[3].category).toBe("");

        // Transfer-Out: negated + transfer detected
        expect(result.transactions[4].amount).toBe(-2693.99);
        expect(result.transactions[4].isTransfer).toBe(true);
        expect(result.transactions[4].transferAccount).toBe(
          "Freedom Unlimited",
        );

        // Transfer accounts collected
        expect(result.transferAccounts).toEqual(["Cash", "Freedom Unlimited"]);

        // Categories collected (no transfer categories)
        expect(result.categories).toContain("Bills:Cable");
        expect(result.categories).toContain("Salary");
        expect(result.categories).toContain("Leisure");
      });

      it("does nothing when amountTypeColumn is not configured", () => {
        const csv = "Date,Amount,Type\n01/15/2026,50.00,Expense\n";
        const config = baseConfig();
        const result = parseCsv(csv, config);

        // Without amountTypeColumn, "Expense" text is ignored
        expect(result.transactions[0].amount).toBe(50);
      });

      it("uses transferAccountColumn for transfer account name when set", () => {
        const csv =
          "Date,Amount,Payee,Category,Type,Account\n01/15/2026,500.00,ATM,Food,Transfer-Out,Savings Account\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferOutValues: ["Transfer-Out"],
          transferAccountColumn: 5,
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("Savings Account");
        expect(result.transactions[0].amount).toBe(-500);
      });

      it("falls back to category when transferAccountColumn is not set", () => {
        const csv =
          "Date,Amount,Payee,Category,Type\n01/15/2026,500.00,ATM,Cash,Transfer-Out\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferOutValues: ["Transfer-Out"],
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].transferAccount).toBe("Cash");
      });

      it("uses transferAccountColumn for transfer-in as well", () => {
        const csv =
          "Date,Amount,Payee,Category,Type,Source\n01/15/2026,500.00,Deposit,Income,Transfer-In,External Account\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferInValues: ["Transfer-In"],
          transferAccountColumn: 5,
        });
        const result = parseCsv(csv, config);

        expect(result.transactions[0].isTransfer).toBe(true);
        expect(result.transactions[0].transferAccount).toBe("External Account");
        expect(result.transactions[0].amount).toBe(500);
      });

      it("skips transfer when transferAccountColumn value is empty", () => {
        const csv =
          "Date,Amount,Payee,Category,Type,Account\n01/15/2026,500.00,ATM,Food,Transfer-Out,\n";
        const config = baseConfig({
          category: 3,
          amountTypeColumn: 4,
          transferOutValues: ["Transfer-Out"],
          transferAccountColumn: 5,
        });
        const result = parseCsv(csv, config);

        // transferAccountColumn is empty, so transfer is not detected
        expect(result.transactions[0].isTransfer).toBe(false);
      });
    });

    describe("tags column", () => {
      it("leaves tagNames empty when the tags column is not mapped", () => {
        const csv =
          "Date,Amount,Payee,Tags\n01/15/2026,-50.00,Store,Food,Groceries\n";
        const result = parseCsv(csv, baseConfig());
        expect(result.transactions[0].tagNames).toEqual([]);
      });

      it("splits on commas when commas dominate the column (quoted fields)", () => {
        // A comma tag-separator is only usable inside quoted cells because the
        // CSV delimiter itself is also a comma. Quoted cells are the
        // real-world shape of this export style.
        const csv = [
          "Date,Amount,Payee,Tags",
          '01/15/2026,-50.00,Store,"Food, Groceries"',
          "01/16/2026,-20.00,Bus,Transport",
          '01/17/2026,-10.00,Cafe,"Coffee, Breakfast"',
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food", "Groceries"]);
        expect(result.transactions[1].tagNames).toEqual(["Transport"]);
        expect(result.transactions[2].tagNames).toEqual([
          "Coffee",
          "Breakfast",
        ]);
      });

      it("splits on semicolons when semicolons dominate the column", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          "01/15/2026,-50.00,Store,Food; Groceries",
          "01/16/2026,-20.00,Shop,Home; Garden",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food", "Groceries"]);
        expect(result.transactions[1].tagNames).toEqual(["Home", "Garden"]);
      });

      it("splits on pipes when pipes dominate the column", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          "01/15/2026,-50.00,Store,Food|Groceries",
          "01/16/2026,-20.00,Shop,Home|Garden",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food", "Groceries"]);
        expect(result.transactions[1].tagNames).toEqual(["Home", "Garden"]);
      });

      it("never treats dashes as a tag separator", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          "01/15/2026,-50.00,Store,work-travel",
          "01/16/2026,-20.00,Shop,home-office",
          "01/17/2026,-10.00,Cafe,out-of-pocket",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["work-travel"]);
        expect(result.transactions[1].tagNames).toEqual(["home-office"]);
        expect(result.transactions[2].tagNames).toEqual(["out-of-pocket"]);
      });

      it("never treats forward slashes as a tag separator", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          "01/15/2026,-50.00,Store,2026/taxes",
          "01/16/2026,-20.00,Shop,personal/travel",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["2026/taxes"]);
        expect(result.transactions[1].tagNames).toEqual(["personal/travel"]);
      });

      it("preserves dashes and slashes inside individual tags when a real separator exists", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          '01/15/2026,-50.00,Store,"work-travel, 2026/taxes"',
          '01/16/2026,-20.00,Shop,"home-office, personal/travel"',
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual([
          "work-travel",
          "2026/taxes",
        ]);
        expect(result.transactions[1].tagNames).toEqual([
          "home-office",
          "personal/travel",
        ]);
      });

      it("treats a single-value field as one tag when no separator appears anywhere", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          "01/15/2026,-50.00,Store,Food",
          "01/16/2026,-20.00,Shop,Home",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food"]);
        expect(result.transactions[1].tagNames).toEqual(["Home"]);
      });

      it("picks the more-frequent separator when multiple appear across rows", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          // 3 rows use semicolon, 1 row uses comma -- semicolon wins.
          "01/15/2026,-50.00,Store,Food; Groceries",
          "01/16/2026,-20.00,Shop,Home; Garden",
          '01/17/2026,-10.00,Cafe,"Coffee, Breakfast"',
          "01/18/2026,-30.00,Gym,Health; Fitness",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food", "Groceries"]);
        // Row that used comma while semicolon is the detected separator is
        // treated as a single tag with the literal comma preserved.
        expect(result.transactions[2].tagNames).toEqual(["Coffee, Breakfast"]);
        expect(result.transactions[3].tagNames).toEqual(["Health", "Fitness"]);
      });

      it("skips empty segments and trims surrounding whitespace", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          '01/15/2026,-50.00,Store,"  Food ,, Groceries  ,  "',
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food", "Groceries"]);
      });

      it("de-duplicates repeated tag names case-insensitively", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          '01/15/2026,-50.00,Store,"Food, FOOD, Groceries, food"',
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food", "Groceries"]);
      });

      it("truncates individual tag names that exceed the 100 character limit", () => {
        const longTag = "a".repeat(150);
        const csv = `Date,Amount,Payee,Tags\n01/15/2026,-50.00,Store,${longTag}\n`;
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toHaveLength(1);
        expect(result.transactions[0].tagNames![0]).toHaveLength(100);
      });

      it("ignores empty tag fields", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          "01/15/2026,-50.00,Store,Food; Travel",
          "01/16/2026,-20.00,Shop,",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual(["Food", "Travel"]);
        expect(result.transactions[1].tagNames).toEqual([]);
      });

      it("strips HTML angle brackets from tag names", () => {
        const csv = [
          "Date,Amount,Payee,Tags",
          "01/15/2026,-50.00,Store,<script>alert(1)</script>; Safe",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ tags: 3 }));

        expect(result.transactions[0].tagNames).toEqual([
          "scriptalert(1)/script",
          "Safe",
        ]);
      });
    });

    describe("reconciliation status column", () => {
      it("leaves cleared/reconciled/void all false when no status column is mapped", () => {
        const csv = "Date,Amount\n01/15/2026,-50.00\n";
        const tx = parseCsv(csv, baseConfig()).transactions[0];
        expect(tx.cleared).toBe(false);
        expect(tx.reconciled).toBe(false);
        expect(tx.void).toBe(false);
      });

      it("maps common CLEARED keywords", () => {
        const csv = [
          "Date,Amount,Status",
          "01/15/2026,-50.00,Cleared",
          "01/16/2026,-30.00,cleared",
          "01/17/2026,-20.00,C",
          "01/18/2026,-10.00,Posted",
          "01/19/2026,-40.00,*",
          "01/20/2026,-60.00,Verified",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ reconciliationStatus: 2 }));
        for (const tx of result.transactions) {
          expect(tx.cleared).toBe(true);
          expect(tx.reconciled).toBe(false);
          expect(tx.void).toBe(false);
        }
      });

      it("maps common RECONCILED keywords", () => {
        const csv = [
          "Date,Amount,Status",
          "01/15/2026,-50.00,Reconciled",
          "01/16/2026,-30.00,reconciled",
          "01/17/2026,-20.00,R",
          "01/18/2026,-10.00,X",
          "01/19/2026,-40.00,matched",
          "01/20/2026,-60.00,Finalized",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ reconciliationStatus: 2 }));
        for (const tx of result.transactions) {
          expect(tx.reconciled).toBe(true);
          expect(tx.cleared).toBe(false);
          expect(tx.void).toBe(false);
        }
      });

      it("maps common VOID keywords", () => {
        const csv = [
          "Date,Amount,Status",
          "01/15/2026,-50.00,Void",
          "01/16/2026,-30.00,voided",
          "01/17/2026,-20.00,Cancelled",
          "01/18/2026,-10.00,canceled",
          "01/19/2026,-40.00,Deleted",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ reconciliationStatus: 2 }));
        for (const tx of result.transactions) {
          expect(tx.void).toBe(true);
          expect(tx.cleared).toBe(false);
          expect(tx.reconciled).toBe(false);
        }
      });

      it("treats explicit unreconciled keywords as UNRECONCILED", () => {
        const csv = [
          "Date,Amount,Status",
          "01/15/2026,-50.00,Pending",
          "01/16/2026,-30.00,Unreconciled",
          "01/17/2026,-20.00,Uncleared",
          "01/18/2026,-10.00,Open",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ reconciliationStatus: 2 }));
        for (const tx of result.transactions) {
          expect(tx.cleared).toBe(false);
          expect(tx.reconciled).toBe(false);
          expect(tx.void).toBe(false);
        }
      });

      it("falls back to UNRECONCILED for empty or unknown values", () => {
        const csv = [
          "Date,Amount,Status",
          "01/15/2026,-50.00,",
          "01/16/2026,-30.00,weirdstring",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ reconciliationStatus: 2 }));
        for (const tx of result.transactions) {
          expect(tx.cleared).toBe(false);
          expect(tx.reconciled).toBe(false);
          expect(tx.void).toBe(false);
        }
      });

      it("matches keywords inside longer descriptive strings", () => {
        const csv = [
          "Date,Amount,Status",
          "01/15/2026,-50.00,Payment reconciled on 2026-01-20",
          "01/16/2026,-30.00,Transaction posted to account",
          "01/17/2026,-20.00,Voided by user",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ reconciliationStatus: 2 }));
        expect(result.transactions[0].reconciled).toBe(true);
        expect(result.transactions[1].cleared).toBe(true);
        expect(result.transactions[2].void).toBe(true);
      });

      it("is case-insensitive and trims whitespace", () => {
        const csv = [
          "Date,Amount,Status",
          "01/15/2026,-50.00,  RECONCILED  ",
          "01/16/2026,-30.00,   cLeArEd",
        ].join("\n");
        const result = parseCsv(csv, baseConfig({ reconciliationStatus: 2 }));
        expect(result.transactions[0].reconciled).toBe(true);
        expect(result.transactions[1].cleared).toBe(true);
      });
    });
  });

  describe("detectTagSeparator (exported helper)", () => {
    it("returns null for an empty list", () => {
      expect(detectTagSeparator([])).toBeNull();
    });

    it("returns null when no candidate separator appears", () => {
      expect(detectTagSeparator(["Food", "Home", "Travel"])).toBeNull();
    });

    it("returns the most frequent candidate", () => {
      expect(detectTagSeparator(["a,b", "c;d", "e;f", "g;h"])).toBe(";");
    });

    it("prefers pipe, then semicolon, then comma on ties", () => {
      // All three present once
      expect(detectTagSeparator(["a|b", "c;d", "e,f"])).toBe("|");
      // Semicolon vs comma tie -- semicolon wins (earlier in list)
      expect(detectTagSeparator(["a;b", "c,d"])).toBe(";");
    });

    it("never picks a dash or slash", () => {
      expect(detectTagSeparator(["a-b", "c-d", "e-f"])).toBeNull();
      expect(detectTagSeparator(["a/b", "c/d"])).toBeNull();
    });

    it("splits and trims individual tags", () => {
      expect(splitTagValue("  Food ,, Groceries  ", ",")).toEqual([
        "Food",
        "Groceries",
      ]);
    });

    it("returns empty array for empty input", () => {
      expect(splitTagValue("", ",")).toEqual([]);
      expect(splitTagValue("   ", null)).toEqual([]);
    });

    it("returns a single tag when separator is null", () => {
      expect(splitTagValue("Food", null)).toEqual(["Food"]);
      expect(splitTagValue("work-travel", null)).toEqual(["work-travel"]);
    });

    it("normalizes reconciliation status to the right enum value", () => {
      expect(normalizeReconciliationStatus("Reconciled")).toBe("RECONCILED");
      expect(normalizeReconciliationStatus("cleared")).toBe("CLEARED");
      expect(normalizeReconciliationStatus("VOID")).toBe("VOID");
      expect(normalizeReconciliationStatus("")).toBe("UNRECONCILED");
      expect(normalizeReconciliationStatus(null)).toBe("UNRECONCILED");
      expect(normalizeReconciliationStatus(undefined)).toBe("UNRECONCILED");
      expect(normalizeReconciliationStatus("anything weird")).toBe(
        "UNRECONCILED",
      );
    });

    it("falls back to substring matches inside longer status sentences", () => {
      expect(normalizeReconciliationStatus("order cancellation pending")).toBe(
        "VOID",
      );
      expect(
        normalizeReconciliationStatus("Payment reconciled on 2026-01-15"),
      ).toBe("RECONCILED");
      expect(normalizeReconciliationStatus("Transaction posted today")).toBe(
        "CLEARED",
      );
      expect(normalizeReconciliationStatus("still pending review")).toBe(
        "UNRECONCILED",
      );
    });

    it("de-duplicates tags case-insensitively and truncates long names", () => {
      expect(splitTagValue("Food, food, FOOD", ",")).toEqual(["Food"]);
      const longTag = "T".repeat(120);
      const [name] = splitTagValue(longTag, ",");
      // TAG limit is 100
      expect(name).toHaveLength(100);
    });

    it("ignores null entries when detecting a tag separator", () => {
      expect(
        detectTagSeparator([null as unknown as string, "a;b", "c;d"]),
      ).toBe(";");
    });
  });
});
