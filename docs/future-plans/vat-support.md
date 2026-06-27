# VAT / GST Support for Monize

## Context

A user asked for "VAT support." VAT (Value Added Tax; GST/HST/PST in Canada, sales tax in the US)
is a consumption tax layered on top of a price: a gross amount = net + tax. Monize today stores a
single signed `amount` per transaction/split with **no tax breakdown**, no tax-rate config, and only
an income-tax-deduction report (keyword-based) that is unrelated to VAT.

The user confirmed the scope:
- **Goal:** both record VAT paid *and* prepare a VAT return (input VAT on purchases vs output VAT on sales).
- **Entry:** configurable rates that auto-calculate the net/VAT split from gross, with manual override.
- **Granularity:** per split line (a receipt can mix 20% and 0% items).
- **Simple transactions:** auto-promote a plain single-category transaction to one category split that carries the VAT (cleanest reporting; VAT always read from one table).
- **Multi-currency (v1):** VAT allowed only on base-currency transactions; document the limitation.

Outcome: users can tag each spend/sale line with a VAT rate, see net vs VAT, and run a VAT-return
report (output - input = net due) available in the UI, the AI Assistant, and MCP.

## Data-model decisions

- **VAT lives on `transaction_splits` only.** `amount` stays **gross** everywhere (no balance-math change). Net is derived at read time as `amount - taxAmount`.
- **Simple transactions auto-promote:** when a non-split transaction is given a VAT rate, the backend materializes a single category split to hold the VAT, reusing the existing split path. So aggregation is always single-table.
- **Direction (input/output) is derived, then denormalized** onto the split at write time. Prefer the category's `isIncome` flag (income -> output VAT, expense -> input VAT), falling back to `Math.sign(amount)`; this correctly handles refunds. Stored in `tax_direction VARCHAR(10)`.
- **New `tax_rates` config table** (user-scoped), modeled on `tags`: `id, user_id, name, rate NUMERIC(7,4), rate_kind ('standard'|'zero'|'exempt'), is_default, is_active, created_at, updated_at`. `rate_kind` keeps the zero-rated vs exempt distinction (both 0 VAT, but report differently).
- VAT is confined to **category** splits — transfers and investment splits never carry VAT (DB CHECK + service guard).

## Calculation (shared util)

New `backend/src/common/vat.util.ts` (+ spec), built on `round.util.ts` integer-ten-thousandths helpers:

```
net = G / (1 + r/100)
vat = roundMoney(G - net)        // preserves sign of gross G
```

Derive net as `G - vat` so `net + vat === gross` exactly (single rounding). `rate_kind` zero/exempt or
`r === 0` -> vat = 0. Manual override: accept DTO `taxAmount` verbatim after `roundMoney`, validating
sign matches and `|taxAmount| < |amount|` (else `BadRequestException`). Mirror a display-only preview
in `frontend/src/lib/vat.ts`.

## Backend changes

### New module `backend/src/tax-rates/` (mirror `tags/`)
- `entities/tax-rate.entity.ts` (decimal `rate` uses `numericTransformer`)
- `dto/create-tax-rate.dto.ts`, `dto/update-tax-rate.dto.ts` (PartialType) — `@SanitizeHtml` name, `@Min(0)@Max(100)` rate, `@IsEnum` rateKind; whitelist validation like `create-tag.dto.ts`
- `tax-rates.service.ts` — `userId`-first CRUD; name-conflict check; single-default enforcement via **QueryRunner** (clears other defaults); `remove` relies on `ON DELETE SET NULL` (keep historical `tax_amount`); record `ActionHistoryService`
- `tax-rates.controller.ts` — `@Controller("tax-rates")`, class-level `AuthGuard('jwt')`, `ParseUUIDPipe` on `:id`
- `tax-rates.module.ts` — `forFeature([TaxRate])`, import `ActionHistoryModule`, export service
- Wire into `backend/src/app.module.ts`

### Split persistence
- `entities/transaction-split.entity.ts` — add `taxRateId`, `taxAmount` (numericTransformer), `taxDirection`, optional `@ManyToOne(() => TaxRate)`
- `dto/create-transaction-split.dto.ts` — add optional `taxRateId` (`@IsUUID`), `taxAmount` (`@IsNumber maxDecimalPlaces:4`); do **not** accept `taxDirection`
- `transaction-split.service.ts` — in `createSplitsInternal` / `addSplit`, for category splits: batch-validate `taxRateId` ownership (reuse the category-ownership pattern), compute or accept-override `taxAmount`, derive `taxDirection`; null for transfer/investment. `updateSplits` round-trips through the DTO so it inherits the fields.
- `transactions.service.ts` — auto-promote: if a simple transaction has `categoryId` + `taxRateId` and no `splits`, build a one-element splits array internally and reuse the split path. Add top-level `taxRateId`/`taxAmount` to `CreateTransactionDto`. Enforce **base-currency-only** for VAT (reject `taxRateId` when `currencyCode !== user default`).

### VAT return report (extend existing tax service)
- `built-in-reports/tax-recurring-reports.service.ts` — add `getVatSummary(userId, startDate, endDate)`: single SQL over `transaction_splits` joined `transactions`/`accounts`/`tax_rates`, filtered like the existing tax query (exclude VOID/transfers/parent splits/investment accounts), grouped by `tax_rate_id` + `tax_direction`. Returns `outputVat`, `inputVat`, `netVatDue = outputVat - inputVat`, and `byRate[]` (rateName, ratePercent, rateKind, netSales, netPurchases, outputVat, inputVat). Use `roundMoney`/`sumMoney`.
- `built-in-reports/dto/vat-summary.dto.ts` (+ barrel `index.ts`)
- `built-in-reports.controller.ts` — `@Get("vat-summary")` taking date range (`ReportQueryDto`); facade passthrough in `built-in-reports.service.ts` if required

### Shared AI tool `get_vat_summary` (BOTH surfaces — hard project rule)
- AI executor: `ai/query/tool-executor.service.ts` add `case "get_vat_summary"` + private method returning `{ data, summary, sources }` (mirror `getSpendingByCategory`); inject the tax/built-in-reports service; add to `tool-definitions.ts` and `tool-input-schemas.ts` (+ their specs)
- MCP: new `mcp/tools/vat.tool.ts` (READ_ONLY, `requireScope(..., "reports")`); add `getVatSummaryOutput` to `mcp/tool-output-schemas.ts`; wire into `mcp-server.service.ts` + `mcp.module.ts`; bump `EXPECTED_TOOL_COUNT` and update `mcp-annotations.spec.ts`, `tool-output-schemas.spec.ts`, `mcp-server.service.spec.ts`

### Migrations + schema
- `database/migrations/086_tax_rates.sql` — `CREATE TABLE IF NOT EXISTS tax_rates` + unique `(user_id, LOWER(name))` index (idempotent)
- `database/migrations/087_transaction_split_vat.sql` — add `tax_rate_id` (FK `ON DELETE SET NULL`), `tax_amount`, `tax_direction`; index on `tax_rate_id`; `chk_split_vat_category_only CHECK (tax_rate_id IS NULL OR kind = 'category')` via guarded `DO $$` block
- Mirror both into `database/schema.sql` (after `tags`, and the `transaction_splits` block)

## Frontend changes

- Editor: `components/transactions/SplitEditor.tsx` — VAT rate `Select` + editable VAT field for category splits only; extend `SplitRow`/`toSplitRows`/`toCreateSplitData` with `taxRateId`/`taxAmount`; recompute via `lib/vat.ts`. `components/transactions/NormalTransactionFields.tsx` — rate selector for simple txns. `components/transactions/TransactionForm.tsx` — fetch rates, include in payload. `types/transaction.ts` — add fields.
- API client + types: new `lib/tax-rates.ts` (mirror `lib/tags.ts`), `types/tax-rate.ts`, `lib/vat.ts`.
- Settings: new `components/settings/TaxRatesSection.tsx` (use `useFormModal`), registered in `app/settings/page.tsx` + `SettingsNav.tsx` (mirror Tags management).
- Report: new `components/reports/VatSummaryReport.tsx` (model on `TaxSummaryReport.tsx`); register `'vat-summary'` in `app/reports/[reportId]/page.tsx` lazy map + `components/reports/index.ts`; add report definition `{ id:'vat-summary', category:'tax' }` in `app/reports/page.tsx`; add `getVatSummary` to `lib/built-in-reports.ts` + response type in `types/built-in-reports.ts`.

## i18n (English-first; full locale pass at acceptance)

- Backend `i18n/locales/en/*.json`: `errors.taxRates.notFound`, `errors.taxRates.nameConflict`, `errors.transactions.vatOnlyOnCategorySplit`, `errors.transactions.vatNonBaseCurrency`, `errors.transactions.vatOverrideInvalid`; actionHistory `created/updated/deletedTaxRate`
- Frontend `i18n/messages/en/*.json`: new `taxRates.json` (register in `i18n/messages.ts`); extend `transactions.json` (split VAT columns), `reports.json` (vat-summary title/labels), `settings.json`/`navigation.json`
- Run `npm run i18n:pseudo` in both; CI parity full-translation pass deferred to final acceptance commit

## Tests

- Backend: `common/vat.util.spec.ts` (formula, signs, rounding, override); `tax-rates.service.spec.ts` + `.controller.spec.ts`; extend `transaction-split.service.spec.ts` (VAT on category only, override, base-currency guard); extend `tax-recurring-reports.service.spec.ts` (`getVatSummary` input/output, per-rate, refund sign); AI `tool-executor`/`tool-definitions`/`tool-input-schemas` specs; `mcp/tools/vat.tool.spec.ts` + count updates; e2e in `backend/test/`
- Frontend: `lib/vat.test.ts`; extend `SplitEditor.test.tsx`; `TaxRatesSection.test.tsx`; `reports/VatSummaryReport.test.tsx`

## Verification

1. Start dev (`docker compose -f docker-compose.dev.yml up`); migrations 086/087 auto-apply — confirm `schema.sql` parity.
2. `cd backend && npm run test:unit && npm run lint && npm run i18n:check`; `cd frontend && npm run test && npm run lint && npm run i18n:check`.
3. App: create rates (Standard 20%, Zero 0%) in Settings -> Tax Rates; create a split txn mixing 20% + 0%; verify net/VAT preview + manual override persist; create an income txn for output VAT; confirm a simple txn with a rate becomes a one-line split.
4. Reports -> VAT Summary for the period: verify output - input = net due and per-rate breakdown.
5. AI parity: run `get_vat_summary` via AI Assistant and via MCP for the same period; numbers must match (shared domain service).

## Risks / edge cases

- **Refunds:** derive direction from category `isIncome` (not raw sign); cover with a test.
- **Rounding:** integer ten-thousandths; net = gross - vat (no third rounding).
- **Transfers/investment splits:** never VATable — CHECK + guard + tests.
- **Zero vs exempt:** distinct `rate_kind`, both 0 VAT.
- **Deleting a rate:** `ON DELETE SET NULL`, keep `tax_amount` so past returns reproduce.
- **Multi-currency:** v1 restricts VAT to base currency (avoids exchange-rate drift vs filed amounts); foreign-currency VAT is a documented follow-up.
- **Coverage:** service/util/report/tool files count toward 85% branch threshold — budget thorough specs.
