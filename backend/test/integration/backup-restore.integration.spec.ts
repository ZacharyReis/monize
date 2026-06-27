import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import { gunzipSync } from "zlib";
import {
  BackupService,
  BackupPasswordRequiredError,
} from "@/backup/backup.service";
import { User } from "@/users/entities/user.entity";
import { OidcService } from "@/auth/oidc/oidc.service";
import { AiEncryptionService } from "@/ai/ai-encryption.service";
import { createTestUserDirect } from "../helpers/integration-setup";

/**
 * Full backup -> restore round-trip against a real PostgreSQL database.
 *
 * The unit suite (src/backup/backup.service.spec.ts) mocks the QueryRunner and
 * asserts the SQL it emits. This integration test instead exercises the whole
 * pipeline end to end: it seeds a realistic dataset for user A, exports it to a
 * gzipped buffer, then restores that buffer into a separate user B on the SAME
 * database and verifies the data survives intact. That round-trip catches
 * things mocks cannot -- FK-safe insert ordering, deferred-FK (Phase 3) UPDATEs,
 * primary-key remapping, user_id rescoping, and the updated_at trigger
 * disable/enable dance.
 */
describe("Backup export/restore round-trip (integration)", () => {
  let module: TestingModule;
  let service: BackupService;
  let dataSource: DataSource;

  // The shared login password createTestUserDirect bakes into every user; the
  // restore flow re-verifies it before touching any data.
  const PASSWORD = "TestPassword123!";

  interface SeededIds {
    parentCategoryId: string;
    childCategoryId: string;
    payeeId: string;
    institutionId: string;
    accountId: string;
    savingsAccountId: string;
    tagId: string;
    expenseTxId: string;
    splitParentTxId: string;
    transferOutTxId: string;
    transferInTxId: string;
  }

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          host: process.env.DATABASE_HOST || "localhost",
          port: parseInt(process.env.DATABASE_PORT || "5432"),
          username: process.env.DATABASE_USER || "monize_user",
          password: process.env.DATABASE_PASSWORD || "monize_password",
          database: process.env.DATABASE_NAME || "monize_test",
          entities: [__dirname + "/../../src/**/*.entity{.ts,.js}"],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([User]),
      ],
      providers: [
        BackupService,
        // Local-auth users never hit OIDC verification, but the constructor
        // requires the dependency to be resolvable.
        { provide: OidcService, useValue: { enabled: false } },
        // Only consulted for backups encrypted with a stored password; the
        // round-trip tests supply the password explicitly instead.
        { provide: AiEncryptionService, useValue: { decrypt: () => "" } },
      ],
    }).compile();

    service = module.get(BackupService);
    dataSource = module.get(DataSource);

    // synchronize:true builds the schema from entity metadata, which does NOT
    // include the updated_at triggers defined in database/schema.sql. The
    // restore disables and re-enables these by name during Phase 3, so they
    // must exist or ALTER TABLE ... DISABLE TRIGGER would fail.
    await dataSource.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    for (const table of [
      "accounts",
      "transactions",
      "scheduled_transactions",
    ]) {
      await dataSource.query(
        `CREATE OR REPLACE TRIGGER update_${table}_updated_at
         BEFORE UPDATE ON ${table}
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
      );
    }
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE transaction_tags, transaction_splits, transactions, tags,
        payees, accounts, institutions, categories, user_preferences,
        currencies, users CASCADE
    `);
  });

  /**
   * Seeds a representative cross-section of a user's data: a user-created
   * currency, preferences, a parent/child category pair, a payee with a default
   * category, an institution, two accounts (one referencing the institution), a
   * tag, a plain expense, a split transaction with two splits, and a linked
   * transfer pair. Together these exercise every deferred-FK column the restore
   * defers to Phase 3.
   */
  async function seedUserData(userId: string): Promise<SeededIds> {
    const ids: SeededIds = {
      parentCategoryId: randomUUID(),
      childCategoryId: randomUUID(),
      payeeId: randomUUID(),
      institutionId: randomUUID(),
      accountId: randomUUID(),
      savingsAccountId: randomUUID(),
      tagId: randomUUID(),
      expenseTxId: randomUUID(),
      splitParentTxId: randomUUID(),
      transferOutTxId: randomUUID(),
      transferInTxId: randomUUID(),
    };

    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, created_by_user_id)
       VALUES ('USD', 'US Dollar', '$', $1)`,
      [userId],
    );
    await dataSource.query(
      `INSERT INTO user_preferences (user_id, default_currency, language)
       VALUES ($1, 'USD', 'en')`,
      [userId],
    );

    await dataSource.query(
      `INSERT INTO categories (id, user_id, name, is_income) VALUES ($1, $2, 'Food', false)`,
      [ids.parentCategoryId, userId],
    );
    await dataSource.query(
      `INSERT INTO categories (id, user_id, parent_id, name, is_income)
       VALUES ($1, $2, $3, 'Groceries', false)`,
      [ids.childCategoryId, userId, ids.parentCategoryId],
    );

    await dataSource.query(
      `INSERT INTO payees (id, user_id, name, default_category_id)
       VALUES ($1, $2, 'Corner Store', $3)`,
      [ids.payeeId, userId, ids.childCategoryId],
    );

    await dataSource.query(
      `INSERT INTO institutions (id, user_id, name, website, has_logo)
       VALUES ($1, $2, 'My Bank', 'https://mybank.example', false)`,
      [ids.institutionId, userId],
    );

    await dataSource.query(
      `INSERT INTO accounts (id, user_id, account_type, name, currency_code,
                             institution_id, current_balance, opening_balance)
       VALUES ($1, $2, 'CHEQUING', 'Checking', 'USD', $3, 850, 1000)`,
      [ids.accountId, userId, ids.institutionId],
    );
    await dataSource.query(
      `INSERT INTO accounts (id, user_id, account_type, name, currency_code,
                             current_balance, opening_balance)
       VALUES ($1, $2, 'SAVINGS', 'Savings', 'USD', 100, 0)`,
      [ids.savingsAccountId, userId],
    );

    await dataSource.query(
      `INSERT INTO tags (id, user_id, name) VALUES ($1, $2, 'essential')`,
      [ids.tagId, userId],
    );

    await dataSource.query(
      `INSERT INTO transactions (id, user_id, account_id, transaction_date,
                                 payee_id, category_id, amount, currency_code, description)
       VALUES ($1, $2, $3, '2026-01-15', $4, $5, -50, 'USD', 'Weekly shop')`,
      [
        ids.expenseTxId,
        userId,
        ids.accountId,
        ids.payeeId,
        ids.childCategoryId,
      ],
    );
    await dataSource.query(
      `INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ($1, $2)`,
      [ids.expenseTxId, ids.tagId],
    );

    // Split transaction: parent has no category, two splits sum to the amount.
    await dataSource.query(
      `INSERT INTO transactions (id, user_id, account_id, transaction_date,
                                 amount, currency_code, is_split)
       VALUES ($1, $2, $3, '2026-01-16', -100, 'USD', true)`,
      [ids.splitParentTxId, userId, ids.accountId],
    );
    await dataSource.query(
      `INSERT INTO transaction_splits (id, transaction_id, kind, category_id, amount)
       VALUES ($1, $2, 'category', $3, -60)`,
      [randomUUID(), ids.splitParentTxId, ids.childCategoryId],
    );
    await dataSource.query(
      `INSERT INTO transaction_splits (id, transaction_id, kind, category_id, amount)
       VALUES ($1, $2, 'category', $3, -40)`,
      [randomUUID(), ids.splitParentTxId, ids.parentCategoryId],
    );

    // Linked transfer pair (each points at the other via linked_transaction_id).
    // Insert both first, then link them mutually -- a forward reference would
    // violate the self-referential FK on the first insert.
    await dataSource.query(
      `INSERT INTO transactions (id, user_id, account_id, transaction_date,
                                 amount, currency_code, is_transfer)
       VALUES ($1, $2, $3, '2026-01-17', -100, 'USD', true)`,
      [ids.transferOutTxId, userId, ids.accountId],
    );
    await dataSource.query(
      `INSERT INTO transactions (id, user_id, account_id, transaction_date,
                                 amount, currency_code, is_transfer)
       VALUES ($1, $2, $3, '2026-01-17', 100, 'USD', true)`,
      [ids.transferInTxId, userId, ids.savingsAccountId],
    );
    await dataSource.query(
      `UPDATE transactions SET linked_transaction_id = $2 WHERE id = $1`,
      [ids.transferOutTxId, ids.transferInTxId],
    );
    await dataSource.query(
      `UPDATE transactions SET linked_transaction_id = $2 WHERE id = $1`,
      [ids.transferInTxId, ids.transferOutTxId],
    );

    return ids;
  }

  async function countRows(table: string, userId: string): Promise<number> {
    const rows = await dataSource.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`,
      [userId],
    );
    return rows[0].n;
  }

  it("restores a full dataset into a separate user with intact relationships", async () => {
    const userA = await createTestUserDirect(dataSource, {
      email: "a@example.com",
    });
    const userB = await createTestUserDirect(dataSource, {
      email: "b@example.com",
    });
    const seeded = await seedUserData(userA.id);

    const buffer = await service.exportToBuffer(userA.id);

    // The export is gzipped JSON with a version header.
    const parsed = JSON.parse(gunzipSync(buffer).toString("utf-8"));
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.transactions).toHaveLength(4);

    const result = await service.restoreData(userB.id, {
      compressedData: buffer,
      password: PASSWORD,
    });

    expect(result.message).toContain("restored");
    expect(result.restored.categories).toBe(2);
    expect(result.restored.accounts).toBe(2);
    expect(result.restored.transactions).toBe(4);
    expect(result.restored.transactionSplits).toBe(2);

    // Row counts under B match what was seeded under A.
    expect(await countRows("categories", userB.id)).toBe(2);
    expect(await countRows("payees", userB.id)).toBe(1);
    expect(await countRows("institutions", userB.id)).toBe(1);
    expect(await countRows("accounts", userB.id)).toBe(2);
    expect(await countRows("tags", userB.id)).toBe(1);
    expect(await countRows("transactions", userB.id)).toBe(4);

    // Primary keys were remapped to fresh UUIDs (restore behaves as if the
    // backup came from a separate system), so none of B's rows reuse A's ids.
    const bAccountIds = (
      await dataSource.query(`SELECT id FROM accounts WHERE user_id = $1`, [
        userB.id,
      ])
    ).map((r: { id: string }) => r.id);
    expect(bAccountIds).not.toContain(seeded.accountId);
    expect(bAccountIds).not.toContain(seeded.savingsAccountId);

    // Deferred FK: the child category's parent_id was rewritten to B's parent
    // category, not left pointing at A's row.
    const childCat = (
      await dataSource.query(
        `SELECT c.parent_id, p.user_id AS parent_user_id, p.name AS parent_name
         FROM categories c JOIN categories p ON c.parent_id = p.id
         WHERE c.user_id = $1 AND c.name = 'Groceries'`,
        [userB.id],
      )
    )[0];
    expect(childCat.parent_user_id).toBe(userB.id);
    expect(childCat.parent_name).toBe("Food");

    // Deferred FK: payee.default_category_id resolves to B's Groceries category.
    const payee = (
      await dataSource.query(
        `SELECT cat.user_id AS cat_user_id, cat.name AS cat_name
         FROM payees pay JOIN categories cat ON pay.default_category_id = cat.id
         WHERE pay.user_id = $1`,
        [userB.id],
      )
    )[0];
    expect(payee.cat_user_id).toBe(userB.id);
    expect(payee.cat_name).toBe("Groceries");

    // Deferred FK: account.institution_id resolves to B's institution.
    const account = (
      await dataSource.query(
        `SELECT inst.user_id AS inst_user_id, inst.name AS inst_name
         FROM accounts acc JOIN institutions inst ON acc.institution_id = inst.id
         WHERE acc.user_id = $1 AND acc.name = 'Checking'`,
        [userB.id],
      )
    )[0];
    expect(account.inst_user_id).toBe(userB.id);
    expect(account.inst_name).toBe("My Bank");

    // Deferred FK: the transfer pair's linked_transaction_id points at the
    // paired transaction, both owned by B.
    const transfers = await dataSource.query(
      `SELECT t.amount, linked.user_id AS linked_user_id, linked.amount AS linked_amount
       FROM transactions t JOIN transactions linked ON t.linked_transaction_id = linked.id
       WHERE t.user_id = $1 ORDER BY t.amount`,
      [userB.id],
    );
    expect(transfers).toHaveLength(2);
    expect(transfers[0].linked_user_id).toBe(userB.id);
    expect(Number(transfers[0].amount)).toBe(-100);
    expect(Number(transfers[0].linked_amount)).toBe(100);

    // Split transaction restored with both split rows summing to the parent.
    const splits = await dataSource.query(
      `SELECT ts.amount FROM transaction_splits ts
       JOIN transactions t ON ts.transaction_id = t.id
       WHERE t.user_id = $1 ORDER BY ts.amount`,
      [userB.id],
    );
    expect(splits.map((s: { amount: string }) => Number(s.amount))).toEqual([
      -60, -40,
    ]);

    // transaction_tag restored and links B's tag to B's transaction.
    const taggedCount = (
      await dataSource.query(
        `SELECT COUNT(*)::int AS n FROM transaction_tags tt
         JOIN transactions t ON tt.transaction_id = t.id
         JOIN tags g ON tt.tag_id = g.id
         WHERE t.user_id = $1 AND g.user_id = $1`,
        [userB.id],
      )
    )[0].n;
    expect(taggedCount).toBe(1);

    // The restore must NOT touch user A's data.
    expect(await countRows("accounts", userA.id)).toBe(2);
    expect(await countRows("transactions", userA.id)).toBe(4);
    const aChecking = (
      await dataSource.query(
        `SELECT institution_id FROM accounts WHERE id = $1`,
        [seeded.accountId],
      )
    )[0];
    expect(aChecking.institution_id).toBe(seeded.institutionId);
  });

  it("round-trips an encrypted backup when the backup password is supplied", async () => {
    const userA = await createTestUserDirect(dataSource, {
      email: "enc-a@example.com",
    });
    const userB = await createTestUserDirect(dataSource, {
      email: "enc-b@example.com",
    });
    await seedUserData(userA.id);

    const encrypted = await service.exportToBuffer(userA.id, "backup-secret");

    const result = await service.restoreData(userB.id, {
      compressedData: encrypted,
      password: PASSWORD,
      backupPassword: "backup-secret",
    });

    expect(result.restored.accounts).toBe(2);
    expect(await countRows("transactions", userB.id)).toBe(4);
  });

  it("rejects an encrypted backup when no decryption password works", async () => {
    const userA = await createTestUserDirect(dataSource, {
      email: "bad-a@example.com",
    });
    const userB = await createTestUserDirect(dataSource, {
      email: "bad-b@example.com",
    });
    await seedUserData(userA.id);

    const encrypted = await service.exportToBuffer(userA.id, "backup-secret");

    await expect(
      service.restoreData(userB.id, {
        compressedData: encrypted,
        password: PASSWORD,
        backupPassword: "wrong-password",
      }),
    ).rejects.toBeInstanceOf(BackupPasswordRequiredError);

    // A failed restore leaves the target user empty.
    expect(await countRows("accounts", userB.id)).toBe(0);
  });

  it("rejects a restore when the confirmation password is invalid", async () => {
    const userA = await createTestUserDirect(dataSource, {
      email: "auth-a@example.com",
    });
    const userB = await createTestUserDirect(dataSource, {
      email: "auth-b@example.com",
    });
    await seedUserData(userA.id);
    const buffer = await service.exportToBuffer(userA.id);

    await expect(
      service.restoreData(userB.id, {
        compressedData: buffer,
        password: "not-the-password",
      }),
    ).rejects.toThrow("Invalid password");

    expect(await countRows("accounts", userB.id)).toBe(0);
  });
});
