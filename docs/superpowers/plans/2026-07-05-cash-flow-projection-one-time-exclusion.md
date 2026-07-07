# Cash-flow Projection One-Time Exclusion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the cash-flow forecast from projecting one-time charges (e.g. debt-settlement payoffs) forward as recurring, via an authoritative per-transaction tri-state flag plus a payee-recurrence default heuristic.

**Architecture:** A nullable `exclude_from_projection` column on `transactions` (NULL=defer to heuristic, TRUE=one-time, FALSE=force-recurring) is honored by `SpendingTrendsService` before any statistical gate. The default heuristic gains a payee-recurrence gate (a payee appearing in only one calendar month across a ≥6-month window, ≥$100, is suggested one-time), which fixes the diagnosed "all null-category rows pool into one bucket" defect. The flag is set from a tri-state control on `TransactionForm` and from a new confirm/override list in the cash-flow view that surfaces the previously-invisible `excludedOutliers`.

**Tech Stack:** NestJS + TypeORM + PostgreSQL (backend, jest); Next.js + React Hook Form + zod + Tailwind (frontend, jest + testing-library); raw-SQL sequential migrations under `database/migrations/`.

## Global Constraints

- Migration is raw SQL, next sequential number **`093`**, in `database/migrations/`.
- Signal is a **nullable tri-state**: `NULL` = defer to heuristic, `TRUE` = one-time (exclude), `FALSE` = force recurring (skip all heuristics).
- Flag lives on the **parent** transaction (`transactions.exclude_from_projection`); the forecast override targets `t.id` (parent), never a split id.
- Constants: `ONE_TIME_EXPENSE_MIN_AMOUNT = 100` (existing), new `PAYEE_RECURRENCE_MIN_MONTHS = 6`.
- The B2 payee gate fires only when: **observed** distinct history months ≥ 6 (NOT requested `lookbackMonths` — Wren #1), the row has a **linked `payee_id`** (a stable payee identity, not a description-only/unlinked row — Wren #6 & rev-2 #2; grouping is keyed by `payee_id`, never the fuzzy name), the row is **not** a scheduled recurring match (`!isScheduledMatch`, matched by `payee_id` + account scope — Wren #2 & rev-2 #1/#2), amount ≥ $100, and that `payee_id` appears in exactly one calendar month.
- Reason strings (plain strings, no enum): `marked_one_time` (flag TRUE), `single_payee_occurrence` (payee gate), plus existing `single_historical_occurrence`, `amount_outlier`.
- Write path reuses `PATCH /transactions/:id` — **no new endpoint**. The service must only write the column when the DTO key is present (`"excludeFromProjection" in updateData`), so `NULL` is distinguishable from "field absent".
- Schema is defined in TWO places that must stay in sync: `database/migrations/NNN_*.sql` (incremental) AND `database/schema.sql` (fresh-install snapshot, per `database/CLAUDE.md`). Every column add touches both (Wren #5).
- i18n: new English keys go in `en/transactions.json` (namespace `transactions`) and `en/bills.json` (namespace `bills`). **`messages.parity.test.ts` requires FULL translations (de, fr, pt-BR, zh-CN, … — no `base`) to mirror `en`'s keys, and requires regional VARIANTS (`en-US`/`en-CA`/`en-GB` — `base: en`) to hold ONLY keys that *differ* from `en`.** It runs under `npm run test:cov` + CI (`i18n:check`, `type-check`). So the new keys are backfilled (English fallback values) into `en` + every **full-translation** locale, and the **variants are skipped** (verbatim English there fails the "duplicates en verbatim" check — Wren rev-2 #3); then `npm run i18n:pseudo` regenerates `xx`. Full translations need only key parity + ICU-arg safety, NOT differing values, so English fallback passes. T-568 is thereby reduced to *translating* these placeholder values.
- Deploy is bare-metal via `./scripts/rebuild.sh` (migrate + build + restart). Migration `093` is `ALTER TABLE ... ADD COLUMN`, so it does not create a new table and the T-555 table-ownership issue does not recur.
- Frontend `Transaction.excludeFromProjection` is **optional** (`?: boolean | null`) so existing typed fixtures that construct `Transaction` without it still type-check (Wren #4).
- This changes live money-forecast math: after implementation, the branch goes through **Wren adversarial review → plan-review gate → live verification** before deploy.

**Branch:** `t-550-one-time-projection-exclusion` (already created; spec at `docs/superpowers/specs/2026-07-05-cash-flow-projection-one-time-exclusion-design.md`).

**Test commands:**
- Backend unit: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
- Backend DTO: `cd backend && npx jest src/transactions/dto`
- Frontend unit: `cd frontend && npm test -- <path>`

---

## File Structure

**Backend:**
- Create `database/migrations/093_transaction_exclude_from_projection.sql` — incremental schema.
- Modify `database/schema.sql` — fresh-install schema mirror (Wren #5).
- Modify `backend/src/transactions/entities/transaction.entity.ts` — entity column.
- Modify `backend/src/built-in-reports/spending-trends.service.ts` — query SELECT (`+ payee_id`, `+ is_scheduled_match` w/ account scope), interfaces, parse, tri-state precedence, payee-recurrence gate (observed-months + payee_id-keyed + scheduled guards).
- Modify `backend/src/built-in-reports/dto/spending-trends.dto.ts` — `transactionId` on `SpendingTrendOutlier`.
- Modify `backend/src/built-in-reports/spending-trends.service.spec.ts` — helper + new tests.
- Modify `backend/src/transactions/dto/create-transaction.dto.ts` — DTO field (inherited by Update via `PartialType`).
- Modify `backend/src/transactions/transactions.service.ts` — whitelist block in `update()`.
- Create `backend/src/transactions/dto/update-transaction.dto.spec.ts` — DTO validation test.
- Modify `backend/test/integration/transactions.integration.spec.ts` — PATCH round-trip test (Wren #7).

**Frontend:**
- Create `frontend/src/lib/projection-intent.ts` — pure string↔`boolean|null` mapping.
- Create `frontend/src/lib/projection-intent.test.ts` — its test.
- Modify `frontend/src/types/transaction.ts` — `excludeFromProjection` on `Transaction` + create/update payload types.
- Modify `frontend/src/components/transactions/TransactionForm.tsx` — schema, init, tri-state control.
- Modify `frontend/src/types/built-in-reports.ts` — `transactionId` on `SpendingTrendOutlier`.
- Create `frontend/src/components/bills/OneTimeExclusionsList.tsx` — the confirm/override list.
- Create `frontend/src/components/bills/OneTimeExclusionsList.test.tsx` — its test.
- Modify `frontend/src/app/bills/page.tsx` — thread `excludedOutliers` + render the list.
- Modify `frontend/src/i18n/messages/*/transactions.json` and `frontend/src/i18n/messages/*/bills.json` — new keys backfilled (English fallback) into `en` + all **full-translation** locales for parity (regional variants `en-US`/`en-CA`/`en-GB` skipped — Wren #3/rev-2 #3); `xx` regenerated via `i18n:pseudo`.

---

## Task 1: Schema — migration 093 + entity column

**Files:**
- Create: `database/migrations/093_transaction_exclude_from_projection.sql`
- Modify: `database/schema.sql` (the `CREATE TABLE transactions` block, ~line 244)
- Modify: `backend/src/transactions/entities/transaction.entity.ts` (near the `is_transfer` column, ~line 171)

**Interfaces:**
- Produces: `transactions.exclude_from_projection BOOLEAN NULL`; entity field `excludeFromProjection: boolean | null`.

- [ ] **Step 1: Write the migration**

Create `database/migrations/093_transaction_exclude_from_projection.sql`:

```sql
-- 093_transaction_exclude_from_projection.sql
-- Cash-flow projection recurrence intent (t-550). Tri-state:
--   NULL  = defer to the statistical heuristic (default / today's behavior)
--   TRUE  = user marked one-time; never project forward
--   FALSE = user marked recurring; always project (override an aggressive guess)
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS exclude_from_projection BOOLEAN NULL;
```

- [ ] **Step 2: Add the entity column**

In `transaction.entity.ts`, immediately after the `isTransfer` column block (~line 172), add:

```ts
  @Column({
    name: "exclude_from_projection",
    type: "boolean",
    nullable: true,
  })
  excludeFromProjection: boolean | null;
```

- [ ] **Step 3: Mirror the column into the fresh-install schema (Wren #5)**

In `database/schema.sql`, in the `CREATE TABLE transactions (...)` block (~line 244, alongside `fitid` / `is_transfer`), add:

```sql
    exclude_from_projection BOOLEAN, -- cash-flow projection recurrence intent (t-550): NULL=heuristic, TRUE=one-time, FALSE=recurring
```

- [ ] **Step 4: Apply the migration, verify schema parity, and build**

Run: `cd backend && psql "$DATABASE_URL" -f ../database/migrations/093_transaction_exclude_from_projection.sql && npm run build`
Expected: migration applies (`ALTER TABLE`), build succeeds with no TypeScript errors.

If a schema-parity verifier exists, run it: `ls ../scripts/verify-schema.sh 2>/dev/null && ../scripts/verify-schema.sh` — expected: schema.sql matches the migrated DB.
(If `DATABASE_URL` is not set in the shell, the deploy path `./scripts/rebuild.sh` applies migrations; for local test the column must exist in the dev DB.)

- [ ] **Step 5: Commit**

```bash
git add database/migrations/093_transaction_exclude_from_projection.sql database/schema.sql backend/src/transactions/entities/transaction.entity.ts
git commit -m "feat(t-550): add transactions.exclude_from_projection tri-state column (migration + schema.sql + entity)"
```

---

## Task 2: Query selects the flag + parent transaction id; outliers carry transactionId

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.ts`
- Modify: `backend/src/built-in-reports/dto/spending-trends.dto.ts`
- Modify: `backend/src/built-in-reports/spending-trends.service.spec.ts`

**Interfaces:**
- Consumes: entity column from Task 1.
- Produces: `HistoricalSpendRow` gains `exclude_from_projection: boolean | null`, `transaction_id: string`, `payee_id: string | null`, `is_scheduled_match: boolean`; `ParsedHistoricalSpend` gains `excludeFromProjection: boolean | null`, `transactionId: string`, `payeeId: string | null`, `isScheduledMatch: boolean`; `SpendingTrendOutlier` gains `transactionId: string`.

- [ ] **Step 1: Update the test helper and write failing tests**

In `spending-trends.service.spec.ts`, replace the `hist` helper (lines ~20-31) with:

```ts
  const hist = (
    categoryId: string | null,
    amount: number,
    date = "2026-03-20",
    payeeName: string | null = "Payee",
    excludeFromProjection: boolean | null = null,
    opts: { payeeId?: string | null; isScheduledMatch?: boolean } = {},
  ) => {
    const seq = rowSeq++;
    // Default payee_id is derived from the name so same-name rows share an id
    // (they group together); pass `{ payeeId: null }` to model a description-only
    // / unlinked row that B2 must ignore.
    const payeeId =
      "payeeId" in opts
        ? opts.payeeId
        : payeeName
          ? `pid-${payeeName.trim().toLocaleLowerCase()}`
          : null;
    return {
      row_id: `row-${seq}`,
      transaction_id: `txn-${seq}`,
      transaction_date: date,
      category_id: categoryId,
      amount: amount.toFixed(2),
      payee_name: payeeName,
      payee_id: payeeId,
      exclude_from_projection: excludeFromProjection,
      is_scheduled_match: opts.isScheduledMatch ?? false,
    };
  };
```

Add these tests at the end of the `describe` block:

```ts
  it("historical SQL selects the flag, parent id, and recurrence signals", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.getSpendingTrends(mockUserId, 3, "all");
    const sql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(sql).toContain("t.exclude_from_projection");
    expect(sql).toContain("as transaction_id");
    expect(sql).toContain("as payee_id");
    expect(sql).toContain("as is_scheduled_match");
  });

  it("account-scoped historical SQL scopes is_scheduled_match to the account (Wren #1)", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.getSpendingTrends(mockUserId, 3, "acct-123");
    const sql = transactionsRepo.query.mock.calls[0][0] as string;
    // the scheduled-match EXISTS must also bind the account param
    expect(sql).toContain("st2.account_id = $4");
  });

  it("all-account historical SQL leaves is_scheduled_match unscoped (no orphan $4)", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.getSpendingTrends(mockUserId, 3, "all");
    const sql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(sql).not.toContain("st2.account_id = $4");
  });

  it("outliers carry the parent transactionId", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-travel", 1200, "2026-03-10", "Hotel")])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-travel", userId: mockUserId, name: "Travel" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers[0].transactionId).toMatch(/^txn-/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts -t "transaction id"`
Expected: FAIL — SQL lacks the new columns; `transactionId` is undefined on the outlier.

- [ ] **Step 3: Implement — SELECT, interfaces, parse, DTO**

**Structural note (Wren rev-2 #1/#2):** B2's identity is keyed on the **`payee_id`** (a stable linked payee), NOT on the fuzzy payee *name*. This dissolves two edge classes at once: it grounds recurrence on a stable id (no name collisions / volatile descriptions — Wren #6), and it lets `is_scheduled_match` match by `payee_id` exactly the way the existing anti-join does, so there is no null-payee identity drift (Wren rev-2 #2). Rows with no `payee_id` are simply not B2-eligible (the tri-state flag still lets the user mark them). `is_scheduled_match` is the anti-join predicate **minus** the `(st.is_split = true OR st.category_id IS NULL)` line (so it also catches unsplit categorized recurring schedules — Wren #2) and **plus** the same account scope the anti-join uses (Wren rev-2 #1).

First, alongside `antiJoinAccountCondition` (~line 101-102), define the account condition for the new subquery (same `$4` param):

```ts
    const scheduledMatchAccountCondition =
      accountId !== "all" ? "AND st2.account_id = $4" : "";
```

Then in the historical query SELECT (lines ~120-125), add the selected columns after the `payee_name` line:

```ts
          ABS(COALESCE(ts.amount, t.amount)) as amount,
          COALESCE(p.name, t.payee_name, t.description) as payee_name,
          t.id::text as transaction_id,
          t.exclude_from_projection as exclude_from_projection,
          t.payee_id::text as payee_id,
          EXISTS (
            SELECT 1 FROM scheduled_transactions st2
            LEFT JOIN accounts sa2 ON sa2.id = st2.account_id
            WHERE st2.payee_id = t.payee_id
              AND ROUND(ABS(st2.amount)::numeric, 2) = ROUND(ABS(t.amount)::numeric, 2)
              AND st2.currency_code = t.currency_code
              AND st2.user_id = t.user_id
              AND st2.is_active = true
              AND st2.is_transfer = false
              AND st2.frequency != 'ONCE'
              AND st2.amount < 0
              AND (st2.occurrences_remaining IS NULL OR st2.occurrences_remaining > 0)
              AND (st2.end_date IS NULL OR st2.end_date >= CURRENT_DATE)
              AND sa2.account_type != 'INVESTMENT'
              AND sa2.is_closed = false
              ${scheduledMatchAccountCondition}
          ) as is_scheduled_match
```

`st2.payee_id = t.payee_id` is never true when `t.payee_id IS NULL`, giving `is_scheduled_match = false` — which is correct, because B2 skips null-payee rows anyway, so the two signals stay perfectly aligned.

Extend `HistoricalSpendRow` (lines ~18-24):

```ts
interface HistoricalSpendRow {
  row_id: string;
  transaction_date: string | Date;
  category_id: string | null;
  amount: string;
  payee_name: string | null;
  transaction_id: string;
  exclude_from_projection: boolean | null;
  payee_id: string | null;
  is_scheduled_match: boolean;
}
```

Extend `ParsedHistoricalSpend` (lines ~32-38):

```ts
interface ParsedHistoricalSpend {
  id: string;
  date: string;
  categoryId: string | null;
  amount: number;
  payeeName: string | null;
  transactionId: string;
  excludeFromProjection: boolean | null;
  payeeId: string | null;
  isScheduledMatch: boolean;
}
```

Update `parseHistoricalRows` (lines ~270-282) to map the new fields:

```ts
      .map((row) => ({
        id: row.row_id,
        date: this.formatDateKey(this.toLocalDate(row.transaction_date)),
        categoryId: row.category_id,
        amount: Math.abs(parseFloat(row.amount)),
        payeeName: row.payee_name,
        transactionId: row.transaction_id,
        excludeFromProjection: row.exclude_from_projection ?? null,
        payeeId: row.payee_id ?? null,
        isScheduledMatch: !!row.is_scheduled_match,
      }))
```

In `filterHistoricalRows`, where the outlier is pushed (lines ~309-316), add `transactionId`:

```ts
          excludedOutliers.push({
            date: row.date,
            categoryId,
            categoryName: categoryNames.get(categoryId) || "Uncategorized",
            amount: this.roundMoney(row.amount),
            payeeName: row.payeeName,
            reason,
            transactionId: row.transactionId,
          });
```

In `dto/spending-trends.dto.ts`, add to `SpendingTrendOutlier`:

```ts
  @ApiProperty() transactionId: string;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
Expected: PASS — all existing tests still green (missing flag parses to `null`), new tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.ts backend/src/built-in-reports/dto/spending-trends.dto.ts backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "feat(t-550): select exclude_from_projection + parent txn id into trends; outliers carry transactionId"
```

---

## Task 3: Tri-state flag precedence in filtering

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.ts`
- Modify: `backend/src/built-in-reports/spending-trends.service.spec.ts`

**Interfaces:**
- Consumes: `ParsedHistoricalSpend.excludeFromProjection` from Task 2.
- Produces: flag `true` → `marked_one_time`; `false` → force-included; `null` → heuristics run.

- [ ] **Step 1: Write failing tests**

Add to `spending-trends.service.spec.ts`:

```ts
  it("excludes a transaction flagged one-time (exclude_from_projection = true)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-food", 1500, "2026-01-20", "Store", null),
        hist("cat-food", 1500, "2026-02-20", "Store", null),
        hist("cat-food", 5000, "2026-03-20", "Settlement", true),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-food", userId: mockUserId, name: "Food" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    const flagged = result.excludedOutliers.find(
      (o) => o.reason === "marked_one_time",
    );
    expect(flagged?.amount).toBe(5000);
    expect(result.trends[0].monthlyAverage).toBe(1000); // (1500+1500)/3
  });

  it("force-includes a recurring-flagged charge the heuristic would drop (false)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-x", 200, "2026-01-20", "A", null),
        hist("cat-x", 200, "2026-02-20", "A", null),
        hist("cat-x", 200, "2026-03-05", "A", null),
        hist("cat-x", 5000, "2026-03-20", "BigButRecurring", false),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-x", userId: mockUserId, name: "X" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers).toHaveLength(0);
    expect(result.trends[0].monthlyAverage).toBeCloseTo((600 + 5000) / 3, 2);
  });

  it("defers to the heuristic when the flag is null", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-travel", 1200, "2026-03-10", "Hotel", null)])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-travel", userId: mockUserId, name: "Travel" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers[0].reason).toBe("single_historical_occurrence");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts -t "flagged"`
Expected: FAIL — the flag is ignored; the $5000 flagged row is averaged in / excluded by the heuristic regardless of the flag.

- [ ] **Step 3: Implement the precedence**

In `filterHistoricalRows`, replace the per-row loop body (lines ~305-320) so the flag is resolved before the heuristic:

```ts
    for (const [categoryId, categoryRows] of grouped) {
      const included: ParsedHistoricalSpend[] = [];
      for (const row of categoryRows) {
        let reason: string | null;
        if (row.excludeFromProjection === true) {
          reason = "marked_one_time";
        } else if (row.excludeFromProjection === false) {
          reason = null; // force include: skip all heuristics
        } else {
          reason = this.getOutlierReason(row, categoryRows);
        }
        if (reason) {
          excludedOutliers.push({
            date: row.date,
            categoryId,
            categoryName: categoryNames.get(categoryId) || "Uncategorized",
            amount: this.roundMoney(row.amount),
            payeeName: row.payeeName,
            reason,
            transactionId: row.transactionId,
          });
        } else {
          included.push(row);
        }
      }

      if (included.length > 0) {
        includedRowsByCategory.set(categoryId, included);
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.ts backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "feat(t-550): honor exclude_from_projection tri-state before the heuristic"
```

---

## Task 4: B2 payee-recurrence heuristic

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.ts`
- Modify: `backend/src/built-in-reports/spending-trends.service.spec.ts`

**Interfaces:**
- Consumes: `ParsedHistoricalSpend.{payeeId,isScheduledMatch}` from Task 2; the existing `countActiveMonths` helper.
- Produces: `single_payee_occurrence` reason; `getOutlierReason` gains `oneTimePayeeIds: Set<string>` and `observedMonths: number` parameters (NOT `monthsUsed`). `filterHistoricalRows` keeps its original 2-arg signature and computes `observedMonths` internally.

**Gate (all must hold, flag NULL only):** `observedMonths >= 6` (distinct months in history, NOT requested lookback — Wren #1) · `row.payeeId` present (stable linked payee, not description/unlinked — Wren #6, rev-2 #2) · `!row.isScheduledMatch` (Wren #2, rev-2 #1/#2) · `amount >= 100` · that `payee_id` seen in exactly one month. `oneTimePayeeIds` is built over rows with a `payeeId` only.

- [ ] **Step 1: Write failing tests**

Add to `spending-trends.service.spec.ts`:

```ts
  it("suggests a payee seen in only one month as one-time (single_payee_occurrence)", async () => {
    // 6 OBSERVED months of Rent + a one-time payoff (1 month), all Uncategorized.
    // Proves the Uncategorized-pooling fix: the payoff is caught, Rent is kept.
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist(null, 1500, "2025-10-15", "Rent"),
        hist(null, 1500, "2025-11-15", "Rent"),
        hist(null, 1500, "2025-12-15", "Rent"),
        hist(null, 1500, "2026-01-15", "Rent"),
        hist(null, 1500, "2026-02-15", "Rent"),
        hist(null, 1500, "2026-03-15", "Rent"),
        hist(null, 4200, "2026-03-20", "DebtSettlementCo"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    const payoff = result.excludedOutliers.find(
      (o) => o.payeeName === "DebtSettlementCo",
    );
    expect(payoff?.reason).toBe("single_payee_occurrence");
    expect(result.trends[0].monthlyAverage).toBe(1500); // (1500*6)/6, payoff excluded
  });

  it("keeps a 2-month payee even when the gate is active (observed >= 6)", async () => {
    // Rent drives observedMonths=6; QuarterlyThing appears in 2 months -> kept.
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist(null, 1500, "2025-10-15", "Rent"),
        hist(null, 1500, "2025-11-15", "Rent"),
        hist(null, 1500, "2025-12-15", "Rent"),
        hist(null, 1500, "2026-01-15", "Rent"),
        hist(null, 1500, "2026-02-15", "Rent"),
        hist(null, 1500, "2026-03-15", "Rent"),
        hist(null, 800, "2025-11-20", "QuarterlyThing"),
        hist(null, 800, "2026-02-20", "QuarterlyThing"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(
      result.excludedOutliers.find((o) => o.payeeName === "QuarterlyThing"),
    ).toBeUndefined();
  });

  it("does not apply the payee gate when OBSERVED history < 6 months", async () => {
    // lookback=6 but only 2 observed months -> gate inert (Wren #1).
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist(null, 300, "2026-02-15", "Sub"),
        hist(null, 300, "2026-03-10", "Sub"),
        hist(null, 300, "2026-03-12", "OneOff"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(
      result.excludedOutliers.find((o) => o.reason === "single_payee_occurrence"),
    ).toBeUndefined();
  });

  it("does not treat an active scheduled recurring charge as one-time (Wren #2)", async () => {
    // 6 observed months; AnnualMembership seen once but is a scheduled match,
    // and is NOT an amount outlier (150 vs 100) -> only B2 could catch it.
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-x", 100, "2025-10-15", "Groceries"),
        hist("cat-x", 100, "2025-11-15", "Groceries"),
        hist("cat-x", 100, "2025-12-15", "Groceries"),
        hist("cat-x", 100, "2026-01-15", "Groceries"),
        hist("cat-x", 100, "2026-02-15", "Groceries"),
        hist("cat-x", 150, "2026-03-15", "AnnualMembership", null, {
          isScheduledMatch: true,
        }),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-x", userId: mockUserId, name: "X" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(
      result.excludedOutliers.find((o) => o.payeeName === "AnnualMembership"),
    ).toBeUndefined();
  });

  it("does not apply the payee gate to description-only rows (Wren #6)", async () => {
    // payee_id=null: volatile descriptions each look like a one-month "payee".
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-x", 100, "2025-10-15", "POS 1234 OCT", null, { payeeId: null }),
        hist("cat-x", 100, "2025-11-15", "POS 5678 NOV", null, { payeeId: null }),
        hist("cat-x", 100, "2025-12-15", "POS 9012 DEC", null, { payeeId: null }),
        hist("cat-x", 100, "2026-01-15", "POS 3456 JAN", null, { payeeId: null }),
        hist("cat-x", 100, "2026-02-15", "POS 7890 FEB", null, { payeeId: null }),
        hist("cat-x", 100, "2026-03-15", "POS 2345 MAR", null, { payeeId: null }),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-x", userId: mockUserId, name: "X" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(
      result.excludedOutliers.find((o) => o.reason === "single_payee_occurrence"),
    ).toBeUndefined();
    expect(result.trends[0].monthlyAverage).toBe(100); // 600/6, all included
  });

  it("preserves amount_outlier for a recurring category with one abnormal charge", async () => {
    // Market spans 6 months (multi-month payee, gate would not fire on it);
    // the 1500 charge must still be caught by amount_outlier.
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-grocery", 200, "2025-10-10", "Market"),
        hist("cat-grocery", 210, "2025-11-10", "Market"),
        hist("cat-grocery", 190, "2025-12-05", "Market"),
        hist("cat-grocery", 205, "2026-01-12", "Market"),
        hist("cat-grocery", 200, "2026-02-12", "Market"),
        hist("cat-grocery", 1500, "2026-03-20", "Market"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-grocery", userId: mockUserId, name: "Grocery" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(
      result.excludedOutliers.find((o) => o.reason === "amount_outlier")?.amount,
    ).toBe(1500);
  });

  it("falls back to existing gates for rows with no payee", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-x", 1200, "2026-03-10", null)])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-x", userId: mockUserId, name: "X" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(result.excludedOutliers[0].reason).toBe("single_historical_occurrence");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts -t "single_payee_occurrence"`
Expected: FAIL — `DebtSettlementCo` is projected (folded into the Uncategorized average) instead of excluded.

- [ ] **Step 3: Implement the payee-recurrence gate**

Add the constant near the other consts (line ~52):

```ts
const PAYEE_RECURRENCE_MIN_MONTHS = 6;
```

Leave the `getSpendingTrends` call site at its original 2-arg form (`filterHistoricalRows` computes `observedMonths` itself):

```ts
    const { includedRowsByCategory, excludedOutliers } =
      this.filterHistoricalRows(parsedHistoricalRows, categoryNames);
```

In `filterHistoricalRows` (lines ~284-291), before the grouping loop, compute observed months and the one-time payee set (keyed by stable `payeeId`, over rows that HAVE a payee id):

```ts
    // Observed history depth: distinct calendar months actually present. Gate
    // B2 on THIS, not the requested lookback (Wren #1).
    const observedMonths = this.countActiveMonths(rows);

    // Payee-recurrence signal (global): a stable-identity payee (payee_id) that
    // appears in exactly one calendar month. Rows without a linked payee id
    // (description-only / unlinked) are excluded — no name/description keying
    // (Wren #6, rev-2 #2).
    const payeeMonths = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.payeeId) continue;
      const months = payeeMonths.get(row.payeeId) ?? new Set<string>();
      months.add(row.date.slice(0, 7));
      payeeMonths.set(row.payeeId, months);
    }
    const oneTimePayeeIds = new Set(
      [...payeeMonths]
        .filter(([, months]) => months.size === 1)
        .map(([id]) => id),
    );

    const grouped = new Map<string | null, ParsedHistoricalSpend[]>();
    for (const row of rows) {
      const existing = grouped.get(row.categoryId) || [];
      existing.push(row);
      grouped.set(row.categoryId, existing);
    }
```

In the per-row loop (from Task 3), change the heuristic call to pass the new context:

```ts
        } else {
          reason = this.getOutlierReason(
            row,
            categoryRows,
            oneTimePayeeIds,
            observedMonths,
          );
        }
```

Change `getOutlierReason` signature and insert the payee gate after the single-occurrence check (lines ~331-337):

```ts
  private getOutlierReason(
    row: ParsedHistoricalSpend,
    rows: ParsedHistoricalSpend[],
    oneTimePayeeIds: Set<string>,
    observedMonths: number,
  ): string | null {
    if (rows.length === 1 && row.amount >= ONE_TIME_EXPENSE_MIN_AMOUNT) {
      return "single_historical_occurrence";
    }

    // Payee-recurrence gate: fires only with enough OBSERVED history (Wren #1),
    // a stable payee identity / linked payee_id (Wren #6, rev-2 #2), no active
    // scheduled match (Wren #2), and the payee seen in exactly one month.
    if (
      observedMonths >= PAYEE_RECURRENCE_MIN_MONTHS &&
      row.payeeId &&
      !row.isScheduledMatch &&
      row.amount >= ONE_TIME_EXPENSE_MIN_AMOUNT &&
      oneTimePayeeIds.has(row.payeeId)
    ) {
      return "single_payee_occurrence";
    }

    if (rows.length < 2) return null;
```

(The rest of `getOutlierReason` — the `amount_outlier` logic — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
Expected: PASS — all tests green (existing tests have < 6 observed months, so the payee gate stays inert for them).

- [ ] **Step 5: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.ts backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "feat(t-550): payee-recurrence heuristic (observed-months + stable-payee + scheduled guards)"
```

---

## Task 5: Write path — DTO field + service whitelist block

**Files:**
- Modify: `backend/src/transactions/dto/create-transaction.dto.ts`
- Modify: `backend/src/transactions/transactions.service.ts` (in `update()`, ~line 2008)
- Create: `backend/src/transactions/dto/update-transaction.dto.spec.ts`
- Modify: `backend/test/integration/transactions.integration.spec.ts` (add a PATCH round-trip test — Wren #7)

**Interfaces:**
- Consumes: entity column from Task 1.
- Produces: `CreateTransactionDto.excludeFromProjection?: boolean | null` (inherited by `UpdateTransactionDto` via `PartialType`); `update()` writes the column only when the key is present.

**Note on `null` validation (Wren raised this):** `@IsOptional()` skips validation when the value is `null` OR `undefined`, so `@IsOptional() @IsBoolean()` accepts `null` (defer-to-heuristic) while still rejecting non-booleans. `false` is present (not null), so it is validated and preserved.

- [ ] **Step 1: Write the failing DTO test**

Create `backend/src/transactions/dto/update-transaction.dto.spec.ts`:

```ts
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateTransactionDto } from "./update-transaction.dto";

describe("UpdateTransactionDto excludeFromProjection", () => {
  const run = async (value: unknown) => {
    const dto = plainToInstance(UpdateTransactionDto, {
      excludeFromProjection: value,
    });
    return validate(dto);
  };

  it("accepts true, false, and null", async () => {
    expect(await run(true)).toHaveLength(0);
    expect(await run(false)).toHaveLength(0);
    expect(await run(null)).toHaveLength(0);
  });

  it("rejects a non-boolean value", async () => {
    const errors = await run("nope");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("excludeFromProjection");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/transactions/dto/update-transaction.dto.spec.ts`
Expected: FAIL — the property does not exist yet, so the invalid-value case is not rejected.

- [ ] **Step 3: Add the DTO field**

In `create-transaction.dto.ts`, ensure `IsBoolean` is imported from `class-validator` (add it to the existing import if missing). Add this field after the `status` field (~line 96):

```ts
  @ApiPropertyOptional({
    description:
      "Cash-flow projection recurrence intent. null = defer to heuristic, " +
      "true = one-time (never project), false = recurring (always project).",
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  excludeFromProjection?: boolean | null;
```

- [ ] **Step 4: Add the service whitelist block**

In `transactions.service.ts`, in the `update()` method, immediately after the `status` block (lines ~2008-2009), add:

```ts
      if ("excludeFromProjection" in updateData)
        transactionUpdateData.excludeFromProjection =
          updateData.excludeFromProjection ?? null;
```

- [ ] **Step 5: Run the DTO test + build**

Run: `cd backend && npx jest src/transactions/dto/update-transaction.dto.spec.ts && npm run build`
Expected: PASS; build succeeds. (`false ?? null` evaluates to `false`, so the force-recurring state is preserved; the `"in"` guard leaves the column untouched when the key is absent.)

- [ ] **Step 6: Add a PATCH round-trip integration test (Wren #7)**

The DTO test proves validator metadata only. This file is a **service-level** integration harness (`service = module.get(TransactionsService)`, `createIntegrationModule`, `createTestUserDirect`, seeded `userId`/`accountId` in `beforeEach`) — NOT HTTP request helpers. Add a persistence test using `service.create/update/findOne`. Mirror the required create-fields (`accountId`, `transactionDate`, `amount`, `currencyCode`) from an existing `service.create(userId, {...})` call in this file (use the seeded account's currency). The test proves all three states persist AND that an absent key leaves the column untouched:

```ts
  it("persists excludeFromProjection tri-state and preserves it when the key is absent", async () => {
    const created = await service.create(userId, {
      accountId,
      transactionDate: "2026-03-15",
      amount: -100,
      currencyCode: "USD", // match the seeded account's currency
      payeeName: "DebtSettlementCo",
    });

    await service.update(userId, created.id, { excludeFromProjection: true });
    expect(
      (await service.findOne(userId, created.id)).excludeFromProjection,
    ).toBe(true);

    await service.update(userId, created.id, { excludeFromProjection: false });
    expect(
      (await service.findOne(userId, created.id)).excludeFromProjection,
    ).toBe(false);

    // An unrelated update that omits the key must NOT reset the column.
    await service.update(userId, created.id, { description: "unrelated edit" });
    expect(
      (await service.findOne(userId, created.id)).excludeFromProjection,
    ).toBe(false);

    await service.update(userId, created.id, { excludeFromProjection: null });
    expect(
      (await service.findOne(userId, created.id)).excludeFromProjection,
    ).toBeNull();
  });
```

Run: `cd backend && npx jest --config ./test/jest-e2e.json --testPathPatterns='test/integration/transactions.integration.spec.ts' --runInBand`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/transactions/dto/create-transaction.dto.ts backend/src/transactions/transactions.service.ts backend/src/transactions/dto/update-transaction.dto.spec.ts backend/test/integration/transactions.integration.spec.ts
git commit -m "feat(t-550): accept + persist excludeFromProjection tri-state on transactions"
```

---

## Task 6: Frontend — TransactionForm tri-state control

**Files:**
- Create: `frontend/src/lib/projection-intent.ts`
- Create: `frontend/src/lib/projection-intent.test.ts`
- Modify: `frontend/src/types/transaction.ts`
- Modify: `frontend/src/components/transactions/TransactionForm.tsx`
- Modify: `frontend/src/i18n/messages/en/transactions.json`

**Interfaces:**
- Consumes: `PATCH /transactions/:id` accepting `excludeFromProjection` (Task 5).
- Produces: `projectionToSelect(boolean|null) => 'auto'|'one_time'|'recurring'` and `selectToProjection(string) => boolean|null`; `Transaction.excludeFromProjection`.

- [ ] **Step 1: Write the failing helper test**

Create `frontend/src/lib/projection-intent.test.ts`:

```ts
import { projectionToSelect, selectToProjection } from './projection-intent';

describe('projection-intent mapping', () => {
  it('maps flag -> select value', () => {
    expect(projectionToSelect(true)).toBe('one_time');
    expect(projectionToSelect(false)).toBe('recurring');
    expect(projectionToSelect(null)).toBe('auto');
    expect(projectionToSelect(undefined)).toBe('auto');
  });

  it('maps select value -> flag', () => {
    expect(selectToProjection('one_time')).toBe(true);
    expect(selectToProjection('recurring')).toBe(false);
    expect(selectToProjection('auto')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- projection-intent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/lib/projection-intent.ts`:

```ts
export type ProjectionSelectValue = 'auto' | 'one_time' | 'recurring';

export function projectionToSelect(
  value: boolean | null | undefined,
): ProjectionSelectValue {
  if (value === true) return 'one_time';
  if (value === false) return 'recurring';
  return 'auto';
}

export function selectToProjection(value: string): boolean | null {
  if (value === 'one_time') return true;
  if (value === 'recurring') return false;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- projection-intent`
Expected: PASS.

- [ ] **Step 5: Wire the control into TransactionForm**

In `frontend/src/types/transaction.ts`, add the field as **optional** to the `Transaction` interface (after `isTransfer`, ~line 76) AND to the create/update payload interfaces (mirror where `status?` appears, ~lines 108/147/176). Optional is required so existing typed fixtures that construct `Transaction` without this field still type-check (Wren #4):

```ts
  excludeFromProjection?: boolean | null;
```

In `TransactionForm.tsx`:

1. Import the helpers near the top:

```ts
import { projectionToSelect, selectToProjection } from '@/lib/projection-intent';
```

2. Add to the zod schema (`buildTransactionSchema`, after the `status` line ~58):

```ts
    excludeFromProjection: z.boolean().nullable().default(null),
```

3. In the edit-branch `defaultValues` (after `status:` at ~line 203), add:

```ts
          excludeFromProjection: initSource.excludeFromProjection ?? null,
```

4. Add the control after the status `<Select>` block (after ~line 1107):

```tsx
      {/* Projection recurrence intent */}
      <Select
        label={t('form.fields.projection')}
        options={[
          { value: 'auto', label: t('form.projectionOptions.auto') },
          { value: 'one_time', label: t('form.projectionOptions.oneTime') },
          { value: 'recurring', label: t('form.projectionOptions.recurring') },
        ]}
        value={projectionToSelect(watch('excludeFromProjection'))}
        onChange={(e) =>
          setValue('excludeFromProjection', selectToProjection(e.target.value), {
            shouldDirty: true,
          })
        }
      />
```

(The `payload` object at ~line 820 already spreads `...data`, so `excludeFromProjection` flows to both create and update automatically. Transfers use a separate `transferData` and are excluded from projections by the query — leave them unchanged.)

5. i18n keys are added to **all** locales in Step 6 (the parity test requires it — Wren #3), not just `en`.

- [ ] **Step 6: Backfill the `transactions` keys into every locale + regen pseudo (Wren #3)**

The keys (`form.fields.projection`, `form.projectionOptions.{auto,oneTime,recurring}`) must exist in every **full-translation** locale or `messages.parity.test.ts` fails. Backfill English-fallback values into `en` + full translations (the 3 regional variants are skipped — see the script's SKIP set), then regenerate the pseudo-locale. From `frontend/`:

```bash
cat > /tmp/backfill-t550-tx.mjs <<'EOF'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'src/i18n/messages';
// SKIP the pseudo-locale AND the regional VARIANTS (base=en in config). The
// parity test requires variant overrides to DIFFER from en, so writing verbatim
// English into en-US/en-CA/en-GB would fail "duplicates en verbatim" (Wren rev-2 #3).
// Variants fall back to the en base per key at load time, so they need nothing.
const SKIP = new Set(['xx', 'en-US', 'en-CA', 'en-GB']);
const patch = { form: { fields: { projection: 'Projection' }, projectionOptions: { auto: 'Auto (detect)', oneTime: "One-time (don't project)", recurring: 'Recurring (always project)' } } };
const merge = (t, s) => { for (const k of Object.keys(s)) { t[k] = (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) ? merge(t[k] ?? {}, s[k]) : (t[k] ?? s[k]); } return t; };
for (const loc of readdirSync(dir)) { if (SKIP.has(loc)) continue; const p = `${dir}/${loc}/transactions.json`; let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; } merge(j, patch); writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); }
EOF
cd frontend && node /tmp/backfill-t550-tx.mjs && npm run i18n:pseudo && npm run i18n:check && npm run type-check && npm test -- projection-intent
```
Expected: `en` + every full-translation locale's `transactions.json` gains the keys (English fallback — full translations need key parity, not differing values); the 3 variants are skipped; `i18n:check`, `type-check`, and `messages.parity.test.ts` pass. Inspect `git diff` — it must ONLY add keys; if the re-serialization reformats existing content, run the repo formatter (`npm run format` / prettier) on the changed files to avoid churn.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/projection-intent.ts frontend/src/lib/projection-intent.test.ts frontend/src/types/transaction.ts frontend/src/components/transactions/TransactionForm.tsx frontend/src/i18n/messages
git commit -m "feat(t-550): tri-state projection control on TransactionForm (+ all-locale keys)"
```

---

## Task 7: Frontend — forecast one-time exclusions list

**Files:**
- Modify: `frontend/src/types/built-in-reports.ts`
- Create: `frontend/src/components/bills/OneTimeExclusionsList.tsx`
- Create: `frontend/src/components/bills/OneTimeExclusionsList.test.tsx`
- Modify: `frontend/src/app/bills/page.tsx`
- Modify: `frontend/src/i18n/messages/en/bills.json`

**Interfaces:**
- Consumes: `SpendingTrendsResponse.excludedOutliers` (each with `transactionId`, `reason`, `amount`, `payeeName`, `categoryName`); `transactionsApi.update(id, { excludeFromProjection })`.
- Produces: `<OneTimeExclusionsList outliers={...} currencyCode={...} onChanged={...} />`.

- [ ] **Step 1: Add the frontend type field**

In `frontend/src/types/built-in-reports.ts`, add to `SpendingTrendOutlier` (~line 324):

```ts
  transactionId: string;
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/components/bills/OneTimeExclusionsList.test.tsx` (mirror the render/query style of `frontend/src/components/ui/Select.test.tsx`):

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OneTimeExclusionsList } from './OneTimeExclusionsList';
import { transactionsApi } from '@/lib/transactions';

jest.mock('@/lib/transactions', () => ({
  transactionsApi: { update: jest.fn().mockResolvedValue({}) },
}));

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const outlier = {
  date: '2026-03-20',
  categoryId: null,
  categoryName: 'Uncategorized',
  amount: 4200,
  payeeName: 'DebtSettlementCo',
  reason: 'single_payee_occurrence',
  transactionId: 'txn-1',
};

describe('OneTimeExclusionsList', () => {
  it('renders excluded outliers', () => {
    render(
      <OneTimeExclusionsList
        outliers={[outlier]}
        currencyCode="USD"
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText('DebtSettlementCo')).toBeInTheDocument();
  });

  it('rescues an outlier (sets excludeFromProjection false) and refetches', async () => {
    const onChanged = jest.fn();
    render(
      <OneTimeExclusionsList
        outliers={[outlier]}
        currencyCode="USD"
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByTestId('rescue-txn-1'));
    await waitFor(() =>
      expect(transactionsApi.update).toHaveBeenCalledWith('txn-1', {
        excludeFromProjection: false,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('renders nothing when there are no outliers', () => {
    const { container } = render(
      <OneTimeExclusionsList outliers={[]} currencyCode="USD" onChanged={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- OneTimeExclusionsList`
Expected: FAIL — component module not found.

- [ ] **Step 4: Implement the component**

Create `frontend/src/components/bills/OneTimeExclusionsList.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { transactionsApi } from '@/lib/transactions';
import type { SpendingTrendOutlier } from '@/types/built-in-reports';
import { formatCurrency } from '@/lib/format';

interface OneTimeExclusionsListProps {
  outliers: SpendingTrendOutlier[];
  currencyCode: string;
  onChanged: () => void;
}

export function OneTimeExclusionsList({
  outliers,
  currencyCode,
  onChanged,
}: OneTimeExclusionsListProps) {
  const t = useTranslations('bills');
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (outliers.length === 0) return null;

  // Flagging is parent-level; collapse split rows that share a parent id so
  // React keys and test ids stay unique (Wren #8).
  const rows = Array.from(
    new Map(outliers.map((o) => [o.transactionId, o])).values(),
  );

  const apply = async (transactionId: string, value: boolean) => {
    setPendingId(transactionId);
    try {
      await transactionsApi.update(transactionId, {
        excludeFromProjection: value,
      });
      onChanged();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {t('forecast.exclusions.title')}
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t('forecast.exclusions.subtitle')}
      </p>
      <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((o) => (
          <li
            key={o.transactionId}
            className="flex items-center justify-between py-2 text-sm"
          >
            <span className="text-gray-800 dark:text-gray-200">
              {o.payeeName || o.categoryName} ·{' '}
              {formatCurrency(o.amount, currencyCode)}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                data-testid={`confirm-${o.transactionId}`}
                disabled={pendingId === o.transactionId}
                onClick={() => apply(o.transactionId, true)}
                className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs"
              >
                {t('forecast.exclusions.confirm')}
              </button>
              <button
                type="button"
                data-testid={`rescue-${o.transactionId}`}
                disabled={pendingId === o.transactionId}
                onClick={() => apply(o.transactionId, false)}
                className="rounded border border-blue-500 px-2 py-1 text-xs text-blue-600 dark:text-blue-400"
              >
                {t('forecast.exclusions.rescue')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

(Confirm the `formatCurrency` import path against an existing bills component; if the util lives elsewhere, use that path.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- OneTimeExclusionsList`
Expected: PASS.

- [ ] **Step 6: Thread excludedOutliers through bills/page.tsx**

In `frontend/src/app/bills/page.tsx`:

1. In `loadTrends` (line ~183-196), add `excludedOutliers` to the `setTrendData` object:

```ts
        totalDailyFill: data.totalDailyFill,
        excludedOutliers: data.excludedOutliers ?? [],
        currencyCode: data.currencyCode,
```

2. Add `excludedOutliers: SpendingTrendOutlier[]` and `currencyCode: string` to the local `trendData` state type (the type argument of the `useState`/setter for `trendData`; add the `SpendingTrendOutlier` import from `@/types/built-in-reports`).

3. Import and render the list next to the forecast chart (after the `<CashFlowForecastChart ... />` at ~line 649):

```tsx
      {trendData && (
        <OneTimeExclusionsList
          outliers={trendData.excludedOutliers}
          currencyCode={trendData.currencyCode}
          onChanged={loadTrends}
        />
      )}
```

with the import:

```ts
import { OneTimeExclusionsList } from '@/components/bills/OneTimeExclusionsList';
```

4. i18n keys (`forecast.exclusions.{title,subtitle,confirm,rescue}`) are added to **all** locales in Step 7 (parity — Wren #3).

- [ ] **Step 7: Backfill the `bills` keys into every locale + regen pseudo (Wren #3)**

Backfill English-fallback values into `en` + full translations' `bills.json` (variants skipped via the script's SKIP set), then regenerate the pseudo-locale. From `frontend/`:

```bash
cat > /tmp/backfill-t550-bills.mjs <<'EOF'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'src/i18n/messages';
// Skip pseudo + regional variants (see the transactions backfill note — Wren rev-2 #3).
const SKIP = new Set(['xx', 'en-US', 'en-CA', 'en-GB']);
const patch = { forecast: { exclusions: { title: 'Treated as one-time', subtitle: 'These charges are not projected forward. Rescue any that actually recur.', confirm: 'One-time', rescue: 'Recurring' } } };
const merge = (t, s) => { for (const k of Object.keys(s)) { t[k] = (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) ? merge(t[k] ?? {}, s[k]) : (t[k] ?? s[k]); } return t; };
for (const loc of readdirSync(dir)) { if (SKIP.has(loc)) continue; const p = `${dir}/${loc}/bills.json`; let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; } merge(j, patch); writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); }
EOF
cd frontend && node /tmp/backfill-t550-bills.mjs && npm run i18n:pseudo && npm run i18n:check && npm run type-check && npm test -- OneTimeExclusionsList
```
Expected: `en` + every full-translation locale's `bills.json` gains the keys; variants skipped; `i18n:check`, `type-check`, and `messages.parity.test.ts` pass. Inspect `git diff` for key-only additions (run the repo formatter if it reflows existing content).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/built-in-reports.ts frontend/src/components/bills/OneTimeExclusionsList.tsx frontend/src/components/bills/OneTimeExclusionsList.test.tsx frontend/src/app/bills/page.tsx frontend/src/i18n/messages
git commit -m "feat(t-550): surface + confirm/override one-time exclusions in the cash-flow forecast (+ all-locale keys)"
```

---

## Task 8: Live verification + runbook

**Files:**
- Modify: `docs/superpowers/plans/2026-07-05-cash-flow-projection-one-time-exclusion.md` (append a "Live verification" record), or a short runbook note.

**Not a TDD task** — the mandatory live-verify gate against the running bare-metal instance.

- [ ] **Step 1: Deploy the branch**

Run: `cd ~/Gentoo_Dev/monize && ./scripts/rebuild.sh`
Expected: migration `093` applied, backend + frontend rebuilt, services restarted. Confirm the column exists:
`psql "$DATABASE_URL" -c "\d transactions" | grep exclude_from_projection`

- [ ] **Step 2: Reproduce the original bug case + record payee_id coverage (Wren rev-3 nit)**

Using Zach's real data (the debt-settlement payoffs), open the Cash Flow forecast. Confirm the inflated projected monthly fill is present (baseline).

**Then check whether the real payoff rows carry a `payee_id`** — the B2 heuristic now only auto-suggests rows with a linked payee:
`psql "$DATABASE_URL" -c "SELECT payee_id, payee_name, description, amount FROM transactions WHERE <the payoff rows> ;"`
Record the result. If the payoff rows have **NULL `payee_id`** (unlinked import), B2 will NOT auto-flag them (`single_payee_occurrence` won't fire) and only the **manual tri-state / forecast-list** path will exclude them — which is still correct behavior, but the "smarter default" won't help this specific case until the rows are linked to a payee. Surface this to Zach explicitly; it may argue for either linking the payees or relaxing B2 to `payee_name` identity in a follow-up.

- [ ] **Step 3: Verify the flag drops the projection**

In the forecast's "Treated as one-time" list (or via the transaction form set to One-time), flag a payoff. Reload. Expected: the projected fill drops by the payoff's contribution; the payoff appears in the excluded list.

- [ ] **Step 4: Verify the FALSE override rescues a charge**

Pick a charge the payee-recurrence heuristic excluded that genuinely recurs; click "Recurring". Reload. Expected: it returns to the projection.

- [ ] **Step 5: Record the result**

Append a short "Live verification — <date>" section to this plan file noting the baseline, the drop, and the rescue, with the observed numbers. Commit.

```bash
git add docs/superpowers/plans/2026-07-05-cash-flow-projection-one-time-exclusion.md
git commit -m "docs(t-550): live verification record"
```

---

## Self-Review

**Spec coverage:** migration+entity (Task 1) ✔; tri-state honored / retroactive (Tasks 2-3) ✔; B2 payee-recurrence + amount_outlier preserved (Task 4) ✔; write path / no new endpoint / null-vs-absent (Task 5) ✔; TransactionForm tri-state (Task 6) ✔; forecast (a) surface+confirm/override with transactionId (Task 7) ✔; testing + live gate (all tasks + Task 8) ✔; deferred forecast (b), import-time, bulk, locale-parity — out of scope, noted. No spec requirement left without a task.

**Type consistency:** `excludeFromProjection` typed `boolean | null` on the entity/backend DTO/`ParsedHistoricalSpend`, and `?: boolean | null` (optional) on the frontend `Transaction`/payload types (Wren #4). `transactionId: string` consistent across `HistoricalSpendRow.transaction_id` → `ParsedHistoricalSpend.transactionId` → `SpendingTrendOutlier.transactionId`. New signals `payee_id`/`is_scheduled_match` → `payeeId`/`isScheduledMatch` threaded query→parse→gate. `getOutlierReason(row, rows, oneTimePayeeIds, observedMonths)` and `filterHistoricalRows(rows, categoryNames)` (2-arg; computes `observedMonths` internally) match their call sites; `oneTimePayeeIds` built + consumed consistently by `payee_id`. `projectionToSelect`/`selectToProjection` names consistent between helper, test, and TransactionForm.

## Wren Review

**rev-1 → NO-GO** (Codex/Wren session `019f33b2-63a0-71b2-bc53-6425bbc3b519`, gpt-5.5/xhigh, 2026-07-05). Nine findings, all verified against the repo and **all folded into rev-2**:

1. HIGH — B2 gated on requested `lookbackMonths`, not observed history → now gates on `observedMonths = countActiveMonths(rows) >= 6` (Task 4).
2. HIGH — scheduled charges not actually protected (anti-join only covers split/uncategorized) → added `is_scheduled_match` EXISTS signal; gate skips scheduled matches (Tasks 2, 4).
3. HIGH — i18n deferral would fail CI (`messages.parity.test.ts` + `i18n:check`) → keys backfilled to all locales with English fallback; T-568 reduced to translation (Tasks 6, 7, Global Constraints).
4. HIGH — required `Transaction.excludeFromProjection` breaks typed fixtures → made optional `?:` (Task 6).
5. MED — `database/schema.sql` not mirrored → added (Task 1).
6. MED — description-only rows treated as stable payees → B2 keyed on `payee_id` (see rev-2 #2 below); rows without a linked payee id are not B2-eligible (Tasks 2, 4).
7. MED — no real PATCH round-trip test → added integration test (Task 5).
8. LOW — split outliers collide in React keys → dedupe by `transactionId` in the list component (Task 7).
9. LOW — Task 5 `cd backend` typo → fixed.

Wren also **confirmed the arithmetic** in rev-1's tests (Rent/Debt, Market IQR high-fence = 225, false-override 1866.67).

**rev-2 → NO-GO** (re-gate, same Wren session). Confirmed all 9 rev-1 folds materially addressed; found 4 new edges introduced by the folds, **all folded into rev-3**:

1. HIGH (rev-2 #1) — `is_scheduled_match` not account-scoped → added `scheduledMatchAccountCondition` (`AND st2.account_id = $4`) + an account-scoped SQL assertion test (Tasks 2, 4).
2. HIGH (rev-2 #2) — `is_scheduled_match` missed null-`payee_id` name-matches → **structural pivot: B2 identity is now keyed on `payee_id`, not the fuzzy name.** B2 only considers rows with a linked `payee_id`; `is_scheduled_match` matches by `payee_id` exactly as the anti-join does; the two signals are aligned by construction, dissolving the null-payee drift AND hardening the volatile-description case (#6) (Tasks 2, 4).
3. HIGH (rev-2 #3) — all-locale backfill breaks regional-variant parity (`en-US`/`en-CA`/`en-GB` must differ from `en`) → backfill script skips the 3 variants; writes `en` + full translations only (which need key parity, not differing values) (Tasks 6, 7, Global Constraints).
4. MED (rev-2 #4) — integration test used non-existent HTTP helpers → rewritten against the real **service-level** harness (`service.create/update/findOne`) (Task 5).

Wren re-confirmed observed-months gating, Rent/Debt = 1500, sparse-history inert, Market `amount_outlier`, false-override 1866.67, tri-state binding, schema.sql, optional typing, dedupe, and the `cd` typo.

**rev-3 → GO** (re-gate, same Wren session, 2026-07-05). All 4 rev-2 folds verified correct: `$4` scoping is sound (no orphan `$4` in the `all` path); the payee_id pivot is internally consistent (B2-eligibility and `is_scheduled_match` aligned by construction, null-payee drift gone); the i18n skip set exactly matches the `base: "en"` variants (`en-US`/`en-CA`/`en-GB`) and full translations pass on key/ICU parity; the integration test matches the real service-level harness. No new blocking defect; parameter numbering stable; no dangling `has_payee` references; existing spec tests stay B2-inert (< 6 observed months). **Three optional nits, all folded:** (1) Task 8 now records real-payoff `payee_id` coverage (B2 auto-suggest only covers linked payees); (2) added an all-account SQL negative assertion (no orphan `$4`); (3) tidied "all locales" prose. Plan is GO for implementation.

**Placeholder scan:** no TBD/TODO; every code step shows real code. Two "confirm the path" notes (frontend `formatCurrency` import; the `trendData` state type location) are pattern-confirmations the implementer resolves against the actual file, not missing logic.

---

## Live Verification — 2026-07-06 (deployed to bare-metal via ./scripts/rebuild.sh)

**Deploy:** `./scripts/rebuild.sh` full run, exit 0. Migration 093 applied to the real `monize` DB (`ALTER TABLE ... ADD COLUMN` — 090/091/092 idempotently re-ran via IF-NOT-EXISTS guards, as expected). Backend `nest build` + frontend `next build` (Next 16.2.6) clean, TypeScript no errors, 43/43 pages. Both OpenRC user services restarted [ok]; `/api/v1/health/ready` → 200 on :3001 (backend) and :3000 (frontend).

**Column state:** `transactions.exclude_from_projection boolean NULL` present. 1993 rows total, **0 non-null** → every existing row defers to the heuristic = today's behavior preserved; no silent behavior change on deploy.

**Step 2 — payee_id coverage (Wren rev-3 nit #1 — the key caveat): RESOLVED, worst case does NOT apply.** Overall linkage is 98.3% (1960/1993 rows carry a `payee_id`; 33 NULL). The real debt-settlement payoffs are all linked, so B2 auto-suggest CAN fire on them (no manual-only fallback needed).

**Step 3 — B2 prediction against real data** (global observed months = 23, ≥ PAYEE_RECURRENCE_MIN_MONTHS):
- PORTFOLIO RECOV PRA INC — 1 distinct month, −$5,633.73 → `single_payee_occurrence` (excluded). The motivating debt-payoff case.
- RESURGENT CAP D002633328 — 1 distinct month, −$3,905.85 → `single_payee_occurrence` (excluded).
- Shellpoint (4 mo), IRS (13 mo), NEWREZ-SHELLPOIN (20 mo) → multi-month → correctly KEPT (recurring). Mortgage/taxes not misflagged.

Result: the two one-time debt-collector payoffs that inflated the projected monthly fill are now excluded; all genuinely-recurring charges retained. Feature verified working on the live ledger. UI confirm/override (Step 4) is the user's eyeball on the /bills forecast "Treated as one-time" list.

**Follow-ups (non-blocking, filed):** error toast in OneTimeExclusionsList.apply() (silent-failure UX gap, plan-mandated); confirm-path + dedupe tests; switch list to useNumberFormat() for locale number-format consistency.

### Live Verification — CORRECTION (2026-07-06, same evening)

The section above overstated the outcome ("the bug is fixed"). It was verified from a DB-level prediction over ALL 23 months of history, NOT the live forecast, which requests `lookbackMonths = preferences.forecastLookbackMonths ?? 3` (frontend/src/app/bills/page.tsx:180). The B2 gate requires `observedMonths >= PAYEE_RECURRENCE_MIN_MONTHS (6)` (Wren #1). A 3-month window yields only 4 observed months, so **B2 is inert in the default view** — `single_payee_occurrence` never fires, and the debt payoffs still project.

Concrete case: Zach recategorized 9 one-time payoffs (Portfolio Recovery ×2, Resurgent ×2, CHECK #9001/#1, AmEx Collection, Discover, Zwicker) into a 'Debt: Settlement' category — all June 2026, total −$24,892.58. In the 3-month view that projected as −$8,297.52/mo Settlement (= 24892.58 / 3). Clustering also defeats the old gates (single_historical_occurrence needs a 1-row bucket; amount_outlier is masked) — exactly the original root cause.

- **What works (deployed, solid):** the manual tri-state. Flagging the 9 payoffs `exclude_from_projection = TRUE` (marked_one_time, resolved before any heuristic, any window) dropped the −$8,297.52 line entirely: projected ending $11,208.66 → $35,550.20; min balance $10,618.05 → $26,880.85. FALSE override (mark Recurring) correctly re-projected AllState/PSEG (short-history false-positives from the OLD gates). The whole tri-state loop verified live on real data.
- **Real follow-up (money-adjacent → full gauntlet):** DECOUPLE B2's recurrence-detection window (wide/fixed, ~12mo) from the projection-average lookback (user's 3mo). Recurrence intent is a property of long history; the projection average is a user preference. Verified: at lookback ≥ 6 (observed=7) all 9 payoffs span 1 month, linked payee, not scheduled-matched → B2 would auto-flag them. The gate is correct; it is starved by the 3-month default.
