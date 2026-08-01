# Native Microsoft Money (.mny) Import: Assessment and Agent Task List

> Design + task breakdown for importing complete Microsoft Money `.mny` files through the Import
> Transactions wizard, using only Monize-native TypeScript (no Python, no Java, no mdbtools, no
> shell pipelines). Supersedes the approach in PR #192 (`poc/import-from-dotmny`) while preserving
> everything that proof of concept learned. Written 2026-07 after a full review of PR #192, its
> comment thread, issue #173, and external research into the .mny format.

## 1. Summary

Microsoft Money `.mny` files are Jet 4 Access databases in a Money-specific variant ("MSISAM"),
RC4-encrypted even when the user never set a password. PR #192 proved a full-fidelity migration is
achievable — two users migrated 25–32 years of data — but did it with an out-of-app toolchain:
a Java JAR (sunriise) to decrypt, `mdb-export` (mdbtools, C) to dump CSV, and a standalone
`migrate.ts` writing raw SQL straight into Postgres. That shape can never ship: it bypasses the
app, deletes all user data unconditionally, needs Java + mdbtools + manual npm installs, and its
data mapping had real bugs (loans, bills, investments — detailed in section 3).

This plan replaces the toolchain with a native pipeline inside the backend:

```
.mny upload (wizard) -> msisam-decrypt.ts (pure TS, ~100 lines) -> vendored mdb-reader (MIT, pure JS)
  -> tolerant table readers -> pure mapping functions -> batched writer (tenantTx)
  -> verification report (file-computed balances vs imported balances)
```

The critical enabler, verified during research: the npm package `mdb-reader` v3.2 already parses
Jet 4 and even *detects* the MSISAM engine string — it only lacks the MSISAM decryption step, and
that algorithm (documented by the jackcess-encrypt project, Apache-2.0) is small: an SHA-1/MD5
password digest plus salt, RC4 per page, and **only file pages 1..0xE are encrypted**. A ~100-line
TypeScript pre-decryptor makes the stock reader work on `.mny` files.

The import runs as a background job with wizard progress polling (a 37k-transaction file cannot
finish inside the current synchronous 300 s import window), stages the decrypted file in the
database so any backend replica can run the job, and ends with a per-account **verification
report** comparing balances computed from the Money file against what landed in Monize — the
trust-builder both PR testers said they needed.

## 2. Goals and non-goals

### Goals

- Import a `.mny` file end-to-end from the existing Import Transactions wizard (`/import`):
  accounts (all types, closed/favourite flags, per-account currencies), payees, categories,
  transactions (splits, transfers, statuses, reference numbers), securities, investment
  transactions, security price history, exchange-rate history, and active scheduled bills.
- Fix every data-quality issue raised on PR #192 (section 3 table).
- Support Money 2001 through Money Plus Sunset file layouts, degrading gracefully when tables
  are absent (Money 2001 has no `BILL` table).
- Pure TypeScript; no new native dependencies; complies with the RLS ratchet (`tenantTx` only).
- Verification report so users can trust the migration without hand-reconciling 56 accounts.

### Non-goals (v1, documented in UI copy and user docs)

- Merging into an already-populated profile with transaction-level dedupe. v1 targets a fresh
  profile, or an explicit opt-in wipe using the existing delete-my-data operation. Accounts are
  still find-or-create by name, so a re-import into a wiped profile is clean.
- Money budgets (`BGT` tables — no clean mapping to Monize budgets), savings goals (no Monize
  entity), classifications beyond standard categories, embedded attachments.
- Writing `.mny` files, or reading `.mbf` backup archives.
- Money 97/98 files (Jet 3 era). Detect and reject with a clear message suggesting an upgrade
  through the free Money Plus Sunset edition (which opens and converts old files).

## 3. Assessment of PR #192

### What the PoC got right (keep all of this)

Credit to marksimpson: the PoC's real contribution is the reverse-engineered schema knowledge in
`migration/ms-money-data-model.md` — table relationships, the `act` action-code semantics
(including the misleading act=16), the phantom-transaction taxonomy, and the LOT table as the
authoritative holdings source. Task M4.5 adopts that document into `docs/` (with attribution)
as the living format reference. Also correct and carried forward:

- Money account type map (`at` 0..6) and the `hacctRel` investment/cash account pairing, which
  matches Monize's linked INVESTMENT_CASH + INVESTMENT_BROKERAGE pair exactly.
- Cleared-status map (`cs` 0/1/2 -> UNRECONCILED/CLEARED/RECONCILED) and voided detection
  (`grftt` bit 0x80 -> VOID).
- Phantom exclusions: bill template transactions (referenced by `BILL.lHtrn`), orphaned transfer
  sides, and split children (`TRN_SPLIT.htrn` rows) must not be imported as standalone rows.
- Currency resolution through `CRNC.szIsoCode`; `SP` price dedup by `(hsec, dt)`; additive
  exchange-rate import.
- Sorting categories by `nLevel` so parents exist before children.

### Issues raised in the PR thread, with root causes and the fix in this design

| # | Issue (reporter) | Root cause | Fix in this design |
|---|---|---|---|
| 1 | Loans/mortgages import with zero transactions; the principal split on the payment shows blank (kenlasko) | Two compounding bugs: (a) the phantom filter excluded `grftt & 0x8000` (auto-entered) rows — but Money marks scheduler-posted loan payments auto-entered, so the loan-side rows vanished; (b) splits were imported as category-only rows, so a split leg that is really a transfer to the loan account lost its transfer nature | Narrow the phantom rule to `frq != -1` only (auto-entered rows are real postings). Import a `TRN_SPLIT` child that appears in `TRN_XFER` as a Monize **transfer split** (`transaction_splits.kind = 'transfer'`, `transfer_account_id` = loan account, `linked_transaction_id` = the loan-side transaction, which is imported once, not duplicated). Interest/escrow legs stay category splits. Validate with the loan scenario in M1.4 and against real files in M3.4 |
| 2 | 1,844 scheduled bills imported when ~20 are real; all then bulk-deactivated (kenlasko) | `BILL` accumulates decades of rows; the PoC imported every row then marked past-due ones inactive | Import only bills detected as active series (`st` status + next-due-date sanity horizon + per-series dedupe — exact semantics pinned by the Phase 0 spike against the known "~20 real" ground truth), and show them as a **checkbox list in the wizard**; unchecked bills are simply not imported. Nothing is created inactive |
| 3 | Junk payees `#` and `*` with zero transactions; never-used categories such as `alimony` (kenlasko) | Money seeds a default category tree and keeps degenerate payee rows; the PoC imported all of `PAY`/`CAT` | Referenced-only import (default on, wizard toggle): only payees/categories referenced by an imported transaction, split, or selected bill are created. Degenerate payee names (`#`, `*`, empty after trim) always skipped. Skip counts shown in the report |
| 4 | Investment accounts "a mess": share counts wrong, negative positions, cost basis nonsense (kenlasko; marksimpson confirmed buy/sell subtleties and FX cost-basis storage quirks) | Four distinct causes: act=16 mapped to SELL (it closes lots but is a *transfer-out*, and mapping it to SELL corrupts average cost); act=4 dividends have **no TRN_INV row** so iterating TRN_INV dropped them entirely; `SEC_SPLIT` (stock splits) ignored, so every post-split position is wrong; qty-sign/action inference inconsistencies | Complete act map driven from TRN not TRN_INV (section 8.4): 4 -> DIVIDEND from `TRN.amt`; 16 -> REMOVE_SHARES, or paired with the matching act=15 row (same date+security+qty across accounts) into linked TRANSFER_OUT/TRANSFER_IN; SEC_SPLIT -> SPLIT transactions; quantity always positive, direction only from act. Holdings produced exclusively by the existing `HoldingsService.rebuildAccountsFromTransactions`. Independently, the mapper computes expected holdings from **LOT open lots** (`htrnSell` empty) and flags disagreements in the verification report instead of silently corrupting positions. Foreign-currency cost basis (Money stores base-currency value at the historical rate) is surfaced as report warnings and documented as a v1 limitation |
| 5 | Money 2001 file crashed on the missing `BILL` table; needed hand-patched `tableExists` (gerardfarrell11) | Reader assumed the Sunset-era table set | Every table access goes through `getTableOrNull`; every column read has a declared default; a per-version column-presence matrix (built in Phase 0 from the 2001/2002/2008 fixtures) is encoded in the row-reader layer. Missing `BILL`/`SEC_SPLIT`/`LOT` degrade the corresponding feature with a preview notice, never a crash |
| 6 | Backend crash-looped on migration `056_monte_carlo_scenarios.sql` ("trigger already exists") until the migration was hand-marked applied (gerardfarrell11 — **not** a .mny issue, but raised in the thread) | A partially-applied migration state plus non-idempotent `CREATE TRIGGER`; the runner `process.exit(1)`s with little diagnostic help | `056` in the current tree is already guarded with a `pg_trigger` existence check. Remaining work is Track B: audit **all** migrations for idempotent DDL (B1), add a CI lint for unguarded DDL in new migrations (B1), and make `db-migrate.ts` failures diagnosable — failing filename, SQL error detail/position, runbook pointer (B2) |
| 7 | Setup friction: manual `npm install pg`, missing `libatomic1`, `.env` password with `$T` mangled by shell interpolation (gerardfarrell11, kenlasko) | Inherent to the external-toolchain design | Disappears entirely with the native in-app import. The Money file password is a form field, never a shell variable |

### PoC design flaws to not repeat (from code review of `migrate.ts`)

- **Deletes all user data unconditionally** before importing (budgets, transactions, accounts,
  payees, categories). In this design the importer never deletes; the wizard offers an optional
  "start fresh" that calls the existing selective `UsersService.deleteData` primitive behind a
  typed confirmation (M3.3).
- **Hardcoded `NZD` fallback currency** (the author's locale). Base currency comes from the Money
  file's own defaults (`DHD` table, spike-confirmed field) with the user's `default_currency`
  preference as fallback.
- **Per-row awaited INSERTs** — 37k transactions and 68k prices, one round-trip each. Replaced by
  chunked multi-row inserts with pre-generated UUIDs (section 6, ADR-9).
- **`ON CONFLICT (user_id, symbol) DO UPDATE`** on securities collapses distinct funds sharing a
  symbol, and empty symbols became `name.slice(0, 20)` — colliding for similarly-named funds.
  Replaced by deterministic suffixing (`VOO-2`) plus a report warning; empty symbols get generated
  unique placeholders (matching the existing importer's placeholder convention).
- **Currency pseudo-securities imported as real securities** — Money stores currencies in `SEC`
  with `sct = 4`; these are excluded.
- **`'z '` name-prefix treated as a closed-account signal** — that is one user's personal naming
  convention, not a Money semantic. Only `fClosed` marks an account closed. Because
  `AccountsService.updateBalance` rejects closed accounts, closure is applied **after** the
  account's transactions are written.
- **Frequency mis-mapping**: Money bimonthly -> BIWEEKLY (wrong: every 2 months vs every 2 weeks)
  and semiannually -> YEARLY. Monize already has `SEMIMONTHLY`; Track B task B3 adds
  `EVERY2MONTHS` and `SEMIANNUAL`. Until B3 lands the mapper downgrades with a per-bill warning.
- **No i18n, no tests, no wizard integration** — all mandatory here (sections 9–10).

## 4. The .mny format and the native parsing strategy

### 4.1 Format facts (verified against jackcess/jackcess-encrypt sources)

- A `.mny` file is a Jet 4 page-structured database. Version byte at offset `0x14` is `0x01`
  (same as Access 2000–2003); the engine-name string at offset `0x04` reads `MSISAM Database`
  instead of `Standard Jet DB`. Page/data layout is Jet 4; only the crypto differs.
- MSISAM files are **always encrypted**, even with no user password (a blank password feeds the
  same key derivation).
- Decryption (from jackcess-encrypt's `MSISAMCryptCodecHandler`, Apache-2.0 — algorithm ported,
  not code copied):
  - Password uppercased, encoded and zero-padded to `0x28` bytes; digested with SHA-1, or MD5
    when the flag bit `0x20` at header offset `0x298` is unset.
  - 8-byte salt at header offset `0x72`; base key = digest (16 bytes) + salt portion; per-page
    key = base key with the page number XORed into the trailing bytes.
  - Cipher is RC4 (trivial in pure TS; not in Node's OpenSSL 3 default provider, so implement
    the ~20-line stream cipher directly).
  - **Only pages 1..0xE are encrypted** ("new encryption", flag `0x6`); the rest of a 200 MB file
    is plaintext Jet 4. Older files use a Jet-style "old encryption" fallback (also RC4-based).
  - Password verification: decrypt 4 bytes near offset `0x2e9` and compare against the salt.
- npm **`mdb-reader` v3.2.0** (MIT, pure JS, actively maintained): parses Jet 3/4 + ACE, returns
  typed values (dates as Date objects, decimals/currency preserved), and already returns a
  dedicated MSISAM format from its detector — but its codec factory has no MSISAM branch, so
  MSISAM files fall through to a no-op codec and the first 14 pages read as ciphertext.

### 4.2 Strategy

**Plan A (primary):** implement `msisam-decrypt.ts` in the backend. It verifies the password,
RC4-decrypts pages 1..0xE of the buffer in place (~56 KB of cipher work regardless of file size),
and hands the now-plaintext buffer to stock `mdb-reader`, whose MSISAM identity-codec path is then
correct. No fork logic, no upstream dependency on our timeline.

**Plan B (fallback, and upstream candidate):** if Plan A trips over a file vintage (old-encryption
files, MD5-flag files), patch a real MSISAM codec handler into the vendored reader — the codec
interface is small and the fix is local. Either way, contribute the codec upstream to
`mdb-reader` as a stretch goal so the vendor copy can eventually be deleted.

**Vendoring:** `mdb-reader` is ESM-only; the backend is CommonJS and Jest runs CJS. Rather than
fight `--experimental-vm-modules`, vendor the reader at
`backend/src/import/mny/vendor/mdb-reader/` with its MIT license header, a `VENDORING.md`
recording version + upstream URL + local diffs (target: none), and coverage/lint exclusions in the
same PR (the same treatment seed scripts already get).

**Fixtures:** the jackcess-encrypt repository ships real sample files in `src/test/data/`:
`money2001.mny`, `money2001-pwd.mny`, `money2002.mny`, `money2008.mny`, `money2008-pwd.mny`
(Apache-2.0; the passwords are recorded in that project's tests). These become committed unit
fixtures with a provenance/license README (M0.1). Real-world acceptance uses the maintainer's
Money Plus Sunset file (56 accounts / 37k transactions / 98 securities / 68k prices) and the
Money 2001 file from the PR thread (72 accounts / 27.5k transactions) via the validation CLI
(M0.5) — those files never enter the repo.

## 5. Existing code this builds on (and its constraints)

Verified by exploration; file paths are current as of this writing.

- **Wizard**: `frontend/src/hooks/useImportWizard.ts` state machine; steps declared in
  `frontend/src/app/import/import-utils.ts` (`ImportStep`) and ordered in
  `frontend/src/app/import/page.tsx`; `UploadStep.tsx` has `accept=".qif,.ofx,.qfx,.csv"`.
  `detectFileType()` falls back to QIF for unknown extensions and the upload path calls
  `file.text()` — the `.mny` branch must be detected **before** any text read and use
  `ArrayBuffer`. `MultiAccountReviewStep.tsx` is the template for the review step;
  `CompleteStep.tsx` for results. The exact accept string is asserted in
  `UploadStep.test.tsx` and `e2e/tests/import.spec.ts` — both must change in the same PR.
- **Backend import module**: `backend/src/import/` — the multi-account QIF path
  (`ImportService.importQifMultiAccountFile`) is the orchestration model (one transaction,
  per-row SAVEPOINT, `ImportEntityCreatorService` for categories/accounts/investment pairs/
  loans/securities, regular + investment processors, `postImportProcessing` doing bulk balance
  recalc + price/FX backfill + net-worth recalc). The .mny writer reuses the entity creator and
  post-processing; it does **not** reuse the QIF heuristic transfer matching (section 6, ADR-8).
- **Transport precedents**: multipart via `FileInterceptor` + `memoryStorage`
  (`backend/src/attachments/attachments.controller.ts`); large raw bodies via a dedicated
  `express.raw` mount (`backend/src/backup/` restore path, 500 MB). Imports today are JSON
  string bodies capped at 10 MB — unusable for binary `.mny`.
- **No job infrastructure exists**: no queues, no job table, no generic SSE (only two hand-rolled
  AI streaming endpoints; the Next proxy passes `text/event-stream` through). Cron via
  `@nestjs/schedule` runs in-process — on Kubernetes, on every replica, so anything cron-adjacent
  must be idempotent/claimed.
- **RLS ratchet (hard CI gate)**: new DB code must use `tenantTx(dataSource, (m) => ...)`
  (`backend/src/common/db/tenant-tx.ts`); the CI script counts `@InjectRepository(` and
  `createQueryRunner(` call sites and fails on any increase. Code without an HTTP request context
  (the background job body, crons) wraps in `withUserContext(userId, fn)` /
  `withSystemContext(fn)`. Existing import helpers take a `queryRunner`-shaped object and only use
  `.manager` / `.query()` — the .mny writer passes a `{ manager, query }` shim backed by the
  `tenantTx` EntityManager, reusing them with **zero** new ratchet sites. New tables need an RLS
  policy in the `user_id`-direct bucket plus a `database/schema.sql` mirror in the same PR.
- **Domain fit** (all existing, reused): transfers = two transaction rows cross-linked via
  `linked_transaction_id`; transfer splits (`transaction_splits.kind='transfer'`); status enum
  matches `cs`; investment cash+brokerage linked pairs match `hacctRel`; `investment_action` enum
  already has BUY/SELL/DIVIDEND/SPLIT/TRANSFER_IN/TRANSFER_OUT/REINVEST/ADD_SHARES/REMOVE_SHARES;
  `HoldingsService.rebuildAccountsFromTransactions(userId, accountIds, queryRunner)` is the
  canonical holdings rebuild; `CurrenciesService.ensureSystemCurrency(code)` creates currencies
  idempotently with proper metadata; `UsersService.deleteData` is the safe selective wipe;
  scheduled transactions support splits/transfers/investment templates and `is_active`.
- **Gaps to fill**: no `EVERY2MONTHS`/`SEMIANNUAL` frequency (B3); categories are two-level
  (deeper Money trees flatten); `is_income` must be derived (spike); no background job table
  (M1.1).

## 6. Architecture decisions

**ADR-1 — Transport: multipart upload.** `POST /api/v1/import/mny/parse` uses
`FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize } })` like attachments,
with `password` as an optional multipart text field. Limit from `MNY_IMPORT_LIMIT_MB` (default
300). No `main.ts` raw-mount changes; traverses the Next proxy (backup restore already proves
large bodies do). Frontend uses per-call axios timeouts (300 s for the upload+parse, 10 s polls).

**ADR-2 — Two-phase flow with server-side staging in the DB.** Parse/preview and import are
separate calls (the wizard's review step sits between). The **decrypted** buffer is staged in a
new `import_staged_files` bytea table (pattern: `attachment_blobs`), keyed by user with `sha256`,
`filename`, `size_bytes`, `expires_at`. Rationale: with more than one backend replica the import
call may land on a different pod than the upload; the database is the only shared store. Staging
post-decryption means the password is used once and never persisted. Import re-parses the staged
bytes (deterministic; no serialized intermediate representation to drift from the parser). Rows
are deleted on completion and swept by a TTL cron (24 h).

**ADR-3 — Asynchronous import job with polling.** `POST /import/mny/start` inserts an
`import_jobs` row (`status`, `options` jsonb, `staged_file_id`, `progress` jsonb, `result` jsonb,
`heartbeat_at`), claims it atomically (`UPDATE ... WHERE id = $1 AND status = 'pending'`), and
runs the import as an unawaited in-process task wrapped in `withUserContext`. The wizard polls
`GET /import/mny/jobs/:id` (~1.5 s). Progress updates are written in their own short `tenantTx`
(writes inside the import transaction would be invisible to pollers). A reaper cron marks jobs
with a stale heartbeat (> 5 min) failed-retryable; the staged file survives, so retry is
one click (new job, same staged file). No queue library, no Redis, no new process.

**ADR-4 — Parsing layers** (each its own file, spec-covered):
`msisam/msisam-decrypt.ts` -> `vendor/mdb-reader/` -> `msisam/open-mny.ts` (wrapper exposing
`getTableOrNull`, column-presence map) -> `tables/*.ts` (typed tolerant row readers) ->
`map/*.ts` (pure functions producing an `MnyImportModel` + warnings) -> `mny-import.service.ts`
(writer). Mappers never touch the DB; the writer never parses. Only the decrypt/reader layers
need binary fixtures — mapper and writer edge cases are plain-object unit tests, which keeps the
95/94/95/85 backend coverage gates reachable.

**ADR-5 — Options are a backend DTO**, echoed with server-computed defaults in the parse
response: `wipeExistingData` (default false), `referencedOnlyPayees` / `referencedOnlyCategories`
(default true), `importClosedAccounts` (default true), per-account `include` +
`currencyOverride`, per-bill selection, `importPrices` / `importExchangeRates` (default true).

**ADR-6 — Memory.** Peak ~2x file size (multer buffer + bytea write); decryption is in-place;
tables materialize one at a time; the preview payload is summaries only (never row data).
Document `MNY_IMPORT_LIMIT_MB` and pod-memory guidance in helm values. A 200 MB file fits a
1 GB pod.

**ADR-7 — Password handling.** Multipart field on `/parse` only; request-scoped; never logged,
never stored, excluded from validation-error echo. Distinct errors: `mnyPasswordRequired` vs
`mnyPasswordIncorrect`. Blank-password files decrypt without prompting.

**ADR-8 — Dedicated intermediate representation.** The .mny pipeline maps Money tables directly
to a domain `MnyImportModel`, not through the QIF `QifFullParseResult`. The QIF IR cannot carry
exact transfer links (`TRN_XFER`), investment transfer/add/remove semantics, bills, price and FX
history, closed/favourite flags, or per-account currencies — and the QIF processor's
name-and-amount transfer *matching* is exactly what a file with authoritative transfer pairs must
not fall back to (it is implicated in the loan-split bug). Lower-level services are reused
(entity creator, currencies, holdings rebuild, shared post-processing extracted from
`ImportService` so both pipelines call one implementation).

**ADR-9 — Write performance.** Pre-generate UUIDs for all transactions/splits in the mapper so
transfer pairs and splits are wired before insert; insert in chunks of ~500 via
`manager.insert`; back-patch `linked_transaction_id` with a single
`UPDATE ... FROM (VALUES ...)` pass; compute per-account balances in memory, write once, then run
the shared bulk recalc as a cross-check. Prices and FX rates are multi-row upserts. Target: the
37k-transaction + 68k-price Sunset file in well under 3 minutes end-to-end.

## 7. Wizard UX

1. **Upload** (existing step): accept gains `.mny`; the file is read as `ArrayBuffer`. If parse
   returns `mnyPasswordRequired`, an inline password prompt appears and the upload retries with
   the password field. Money 97/98 (Jet 3) files get the explicit unsupported-version message.
2. **Review** (new `mnyReview` step, modelled on `MultiAccountReviewStep`):
   - File summary: detected Money era, base currency, table availability notes ("No
     scheduled-bills table — Money 2001 format").
   - Account table with include checkboxes: name, mapped type, currency (overridable), transaction
     count, opening balance, **final balance computed from the file**, closed/favourite badges.
     Closed accounts included by default, badge shown.
   - Counts row: payees (referenced/total), categories (referenced/total), securities (real, with
     pseudo-currency exclusions noted), prices, FX rates, bills ("21 active of 1,844 rows").
   - Options panel (ADR-5) including the wipe-first checkbox with a typed-confirmation dialog
     that names the existing delete-my-data operation it invokes.
   - Bills panel (when `BILL` exists): checkbox list of detected-active bills (payee, amount,
     frequency, next due), active candidates pre-checked.
   - Mapper warnings surfaced inline (symbol collisions, unknown act codes, frequency
     downgrades, LOT mismatches).
3. **Import** (new `mnyImporting` step): polls the job; phase progress (Preparing, Accounts &
   reference data, Transactions n/total, Investments, Bills, Prices & rates, Finalizing,
   Verifying). Failure shows the localized error with Retry (reuses staged file) / Start over.
4. **Complete** (extended): existing result counts plus the **verification report**: per account,
   expected final balance (recomputed from file data by the parser) vs imported balance vs delta
   with pass/warn state; per brokerage account, per-security share counts from transaction replay
   vs LOT-derived open lots; downloadable JSON. Banner: "All 56 accounts match" or "3 accounts
   differ — details below".

## 8. Data-mapping specification

### 8.1 Reference data

| Money source | Monize target | Rules |
|---|---|---|
| `DHD` (file defaults) | base currency context | Spike-confirmed field for the file's default currency handle; fallback = user's `default_currency` preference. Never a hardcoded literal |
| `CRNC` | `currencies` via `ensureSystemCurrency` | Only currencies actually referenced by imported accounts/securities/rates |
| `CRNC_EXCHG` | `exchange_rates` | Additive upsert on `(from, to, rate_date)`; toggle-controlled |
| `PAY` | `payees` | Referenced-only (default), degenerate-name filter, existing-payee find-or-create by name |
| `CAT` | `categories` | Parents before children (`nLevel`); flatten deeper than two levels into `Parent:Child` names; `is_income` derived per spike (root-ancestor classification, transaction-sign heuristic as fallback); referenced-only default |
| `SEC` (`sct != 4`) | `securities` | Per-user unique symbol; collision suffixing (`VOO-2`) + warning; empty symbols get unique placeholders with `skip_price_updates`; currency via `CRNC` map |
| `SP` | `security_prices` | Dedupe `(hsec, dt)` keep-latest; batch upsert; `source` marks the import |
| `ACCT` | `accounts` | `at` map: 0 bank -> CHEQUING, 1 -> CREDIT_CARD, 2 -> CASH, 3 -> ASSET, 4 -> LOAN, 5 -> INVESTMENT (paired), 6 -> MORTGAGE. `amtOpen` -> opening balance; `fFavorite` -> favourite; `hacctRel` on `at=5` -> linked cash/brokerage pair (reusing the entity creator's pair logic); `fClosed` -> closed **after** transactions are written |

### 8.2 Transactions

- Include a `TRN` row when: it has an account, a valid date, is not a split child, not a bill
  template (`BILL.lHtrn`), not an orphaned transfer side, and `frq == -1`.
  **Auto-entered (`grftt & 0x8000`) rows are imported** — they are real postings (loan payments,
  online-banking imports); excluding them was PR bug #1.
- `grftt & 0x80` -> status VOID (imported, excluded from balances by existing logic).
- `cs`: 0 -> UNRECONCILED, 1 -> CLEARED, 2 -> RECONCILED. `dt` -> `transaction_date`
  (`YYYY-MM-DD` string per repo DATE convention; mdb-reader decodes Jet datetimes natively, which
  should obsolete the PoC's MM/DD/YY 70-year-pivot parsing — spike confirms; day-00 null
  sentinel handling stays). `szId` -> `reference_number`, `mMemo` -> `description`,
  `lHpay` -> payee, `hcat` -> category, `amt` -> amount (account currency).
- Splits: for each `TRN_SPLIT` child, category/amount/memo come from the child `TRN` row. A child
  that appears in `TRN_XFER` becomes a **transfer split** wired to the counterpart transaction's
  pre-generated UUID; the counterpart imports once as the loan/destination-side row.
- Transfers: `TRN_XFER` pairs -> both rows `is_transfer = true` and cross-linked
  `linked_transaction_id` (exact IDs — no name/amount matching). Cross-currency pairs keep each
  side's own amount.

### 8.3 Bills

`BILL` + template `TRN` (`lHtrn`) -> `scheduled_transactions` with splits/transfer/investment
template support. Active-series detection: `st` in the spike-confirmed active set, next-due date
within a sanity horizon, deduped per series. Wizard selection is authoritative; selected bills
import with `is_active = true`, `auto_post = false`. Frequency map: 0 ONCE, 1 DAILY, 2 WEEKLY,
3 MONTHLY, 4 YEARLY, 5 -> `EVERY2MONTHS` (B3), 6 QUARTERLY, 7 -> `SEMIANNUAL` (B3);
`cFrqInst` interval honored where representable, else downgrade + warning.

### 8.4 Investments

Action mapping is driven from `TRN.act` (never from quantity sign; `TRN_INV.qty` is always
positive):

| act | Monize action | Notes |
|---|---|---|
| 0 | BUY | |
| 1 | SELL | |
| 3, 5 | REINVEST | act=5 variant noted in description; spike confirms distinction |
| 4 | DIVIDEND | **No `TRN_INV` row exists** — sourced from `TRN` directly, amount = `amt`, no quantity. The PoC iterated `TRN_INV` and dropped every one of these |
| 14 | CAPITAL_GAIN + warning | Rare cash corporate actions; spike refines |
| 15 | ADD_SHARES (cost basis from `amt`/`dPrice`) | Opens lots |
| 16 | REMOVE_SHARES — never SELL | Closes lots despite the name |
| 15+16 pair | TRANSFER_IN / TRANSFER_OUT | Paired across accounts by date + security + quantity; cross-linked via `linked_transaction_id`; unpaired rows stay ADD/REMOVE_SHARES |

`SEC_SPLIT` -> SPLIT investment transactions (ratio applied by the existing holdings fold).
Cash legs use `TRN.amt` in the account currency. Holdings come only from
`HoldingsService.rebuildAccountsFromTransactions` after the write; the mapper's independent
LOT-derived open-lot positions (`htrnSell` empty, sum `qty`) and its action-replay positions are
compared and any disagreement becomes a verification-report warning. Foreign-currency cost basis
differences (Money stores base-currency values at historical rates) surface as warnings —
documented v1 limitation.

## 9. Task list

> Sized for one agent session/PR each (S < half day, M = half–2 days, L = 2–5 days). Do tasks in
> dependency order. Definition of done for every task: `npm run build && npm run lint` clean in
> the touched workspace; unit tests green at the coverage gates; any migration mirrored into
> `database/schema.sql` in the same PR; RLS ratchet counts not increased; user-facing strings
> through i18n **English-first** (`en` catalogs + `npm run i18n:pseudo`; the full 23-locale pass
> is the single M4.3 task, per the project's i18n workflow); no emojis; immutability rules.
> Money-file knowledge lives in `ms-money-data-model.md` (adopted in M4.5) — read it before any
> mapper task.

### Phase 0 — Spike, fixtures, foundations

Exit gate: all five jackcess fixtures parse end-to-end via the CLI; go/no-go on Plan A recorded.

| ID | Task | Depends | Size |
|----|------|---------|------|
| M0.1 | Commit jackcess-encrypt sample fixtures (`money2001.mny`, `money2001-pwd.mny`, `money2002.mny`, `money2008.mny`, `money2008-pwd.mny`) under `backend/src/import/mny/__fixtures__/` with provenance/license README (Apache-2.0) and documented passwords | — | S |
| M0.2 | `msisam/msisam-decrypt.ts`: RC4, key derivation (SHA-1/MD5 flag at `0x298`), salt at `0x72`, page loop 1..0xE, page-number key XOR, old-encryption fallback, password verify near `0x2e9`. Spec: all five fixtures decrypt; wrong password -> typed error; blank-password files open without a password | M0.1 | M |
| M0.3 | Vendor `mdb-reader` v3.2.0 + `msisam/open-mny.ts` wrapper (`getTableOrNull`, column-presence map, engine sanity checks); Jest/ESLint/coverage exclusions for the vendor dir; confirm identity-codec reads pre-decrypted buffers. Spec: table lists + row counts correct for all fixtures | M0.2 | M |
| M0.4 | Tolerant table readers (`tables/read-reference.ts`, `read-transactions.ts`, `read-investments.ts`, `read-bills.ts`) + typed raw-row model (`model/mny-rows.ts`) + date/amount normalization utils; build the per-version column-presence matrix across fixtures and encode defaults. Spec: every table reads or degrades gracefully on all fixtures | M0.3 | L |
| M0.5 | Validation-harness CLI: `npm run mny:validate -- file.mny [--password ...]` prints accounts, transaction counts, per-account computed final balances, per-security holdings (replay + LOT), warnings. Excluded from coverage like seed scripts. Acceptance: maintainer runs it on the real Sunset and Money 2001 files; output sane; runtime + memory recorded in the PR | M0.4 | M |
| M0.6 | Spike report resolving open questions (section 12): DHD base-currency field, CAT `is_income` signal, BILL `st` active semantics (validated against the known "~20 real bills" ground truth), act 5 vs 3 and act 14 semantics, native date decoding vs pivot logic. Constants land in `model/mny-model.ts` with the findings documented | M0.5 | M |

### Track B — Parallel, not .mny-specific

| ID | Task | Depends | Size |
|----|------|---------|------|
| B1 | Migration idempotency audit: guard all unguarded `CREATE TRIGGER` / `CREATE POLICY` / `CREATE INDEX` / `ADD COLUMN` / enum-value DDL across `database/migrations/*.sql` (mirroring the existing `056` pg_trigger guard); add a CI lint script that flags unguarded DDL in new migrations. Acceptance: re-running any migration body against an up-to-date DB is a no-op | — | M |
| B2 | `backend/src/db-migrate.ts` failure UX: log failing filename, SQL error detail/position, and a runbook pointer before the non-zero exit (fail-fast retained); unit specs; short runbook section for the "partially applied" recovery that PR #192's thread walked through by hand | — | S |
| B3 | Frequency extension `EVERY2MONTHS` + `SEMIANNUAL`: `FrequencyType`, next-due-date calculator, scheduled-transaction UI selector, English catalogs + pseudo-locale. Acceptance: next-occurrence math specs for both | — | M |

### Phase 1 — Core banking import, end-to-end behind the wizard (shippable)

| ID | Task | Depends | Size |
|----|------|---------|------|
| M1.1 | Entities + migration + RLS: `import_staged_files` (bytea, user-owned, `expires_at`), `import_jobs` (`status`, `options`, `progress`, `result`, `heartbeat_at`); `user_id`-direct RLS policies; `database/schema.sql` mirrored. Acceptance: cross-user isolation spec; ratchet unchanged | — | M |
| M1.2 | Staging service (`tenantTx`) + TTL sweep cron + delete-on-complete; `docs/cron-jobs.md` entry. Acceptance: expiry works; sweep idempotent across replicas | M1.1 | S |
| M1.3 | Reference mapper (`map/map-reference.ts`): currencies (DHD base + `ensureSystemCurrency`), accounts (type/subtype map, `hacctRel` pairs, deferred closure, favourites, opening balances), categories (flatten, `is_income`, referenced-only), payees (junk filter, referenced-only), warnings model. Unit fixtures cover every `at` value, deep category trees, junk payees | M0.4, M0.6 | L |
| M1.4 | Transaction + transfer mapper (`map/map-transactions.ts`, `map/map-transfers.ts`): inclusion rule (`frq != -1` only — auto-entered rows import), statuses/void, splits, `TRN_XFER` pairing with pre-generated UUIDs, **loan-payment transfer splits**, reference numbers. Acceptance: loan fixture yields a transfer split linked to the loan-side transaction, each side imported exactly once | M1.3 | L |
| M1.5 | Parser service + preview builder (`mny-parser.service.ts`): orchestrates decrypt -> read -> map; computes per-account final balances (the verification baseline). Acceptance: preview for `money2008.mny` matches hand-computed values | M1.3, M1.4 | M |
| M1.6 | Controller + DTOs: `POST /import/mny/parse` (multer memoryStorage, `password` field, `MNY_IMPORT_LIMIT_MB`, i18n error taxonomy incl. required-vs-incorrect password and Jet 3 rejection), `POST /import/mny/start`, `GET /import/mny/jobs/:id`, `DELETE /import/mny/staged/:id`. Acceptance: contract specs; password never logged or echoed; oversized file -> clean localized error | M1.1, M1.5 | M |
| M1.7 | Job service: atomic claim, heartbeat, progress writer in its own `tenantTx`, stale reaper cron, retry semantics (staged file survives failure). Acceptance: simulated double-claim has a single winner; stale running job reaped to failed-retryable | M1.1 | M |
| M1.8 | Writer v1 (`mny-import.service.ts`, `writers/write-transactions.ts`): optional wipe via existing `UsersService.deleteData` (own transaction, before the job body), entity creation via the `{manager, query}` shim over `tenantTx`, chunked inserts + `linked_transaction_id` back-patch, single balance write per account, deferred account closure, **shared `postImportProcessing` extracted** from `ImportService` and called by both pipelines, verification report v1 (balances). Acceptance: integration spec imports a fixture and balances match parser-computed values; QIF suite still green after the extraction; no new ratchet sites | M1.4–M1.7 | L |
| M1.9 | Frontend: `useMnyImport` hook (upload, options, start, polling, retry) composed into `useImportWizard`; `detectFileType` + ArrayBuffer path; `ImportStep` additions (`mnyReview`, `mnyImporting`) + `page.tsx` step order; `MnyReviewStep`, `MnyImportProgress`; `CompleteStep` verification table; accept-string updated **with** `UploadStep.test.tsx` and the e2e assertion; `lib/import-mny-api.ts` with per-call timeouts; English catalogs + pseudo-locale. Vitest to gates | M1.6 | L |
| M1.10 | Verification report UI: pass/warn rows, JSON download, trust-builder copy | M1.8, M1.9 | S |

### Phase 2 — Investments (shippable increment)

| ID | Task | Depends | Size |
|----|------|---------|------|
| M2.1 | Securities mapper: `sct=4` exclusion, symbol-collision suffixing, empty-symbol placeholders. Acceptance: collision fixture creates two securities + warning, never collapses | M1.3 | M |
| M2.2 | Investment mapper (`map/map-investments.ts`): full act map per section 8.4 (incl. act=4 dividends sourced from `TRN` without `TRN_INV`), act 15+16 transfer pairing, `SEC_SPLIT` -> SPLIT, positive-qty policy, cash legs. Unit fixtures per act code | M2.1, M0.6 | L |
| M2.3 | LOT cross-check: open-lot holdings vs action-replay holdings -> verification warnings (never import failures). Seeded-mismatch fixture produces a warning | M2.2 | M |
| M2.4 | Investment writer (`writers/write-investments.ts`): batched investment transactions + cash legs, `HoldingsService.rebuildAccountsFromTransactions` per affected brokerage account, holdings section in the report. Acceptance: fixture holdings equal LOT-derived positions; negative-holdings regression test covering the PR #192 failure mode | M2.2, M1.8 | L |
| M2.5 | Prices + FX writer: `SP` dedupe keep-latest, multi-row upserts to `security_prices` (import source marker) and `exchange_rates`; toggles honored. Acceptance: synthetic 68k-price set imports < 30 s in the integration environment | M2.1 | M |
| M2.6 | Wizard: securities summary on review, holdings section in the verification report, investment progress phase | M2.4, M1.9 | M |

### Phase 3 — Bills, loans polish, wipe UX (shippable increment)

| ID | Task | Depends | Size |
|----|------|---------|------|
| M3.1 | Bills mapper (`map/map-bills.ts`): active-series detection (`st` + due-date horizon + series dedupe per M0.6), `lHtrn` template resolution (splits/transfer/investment templates), frequency map using B3 (downgrade + warn fallback while B3 unmerged). Acceptance: the kenlasko scenario yields ~20 active candidates from 1,844 rows; Money 2001 absence degrades with a notice | M0.6, M1.4 | L |
| M3.2 | Bills writer + wizard selection panel (`MnyBillsPanel`): only selected bills imported, `is_active=true`, `auto_post=false`. Acceptance: unchecked bills are absent from the DB, not inactive | M3.1, M1.9 | M |
| M3.3 | Wipe-first UX: typed-confirmation dialog naming the delete-my-data operation, wiring to `deleteData` as a pre-step, report line "existing data removed". Default import never deletes | M1.8 | S |
| M3.4 | Loan verification on real files: loan/mortgage balances in the report, mortgage subtype mapping, escrow split refinement. Acceptance: maintainer's loan accounts reconcile in the harness | M1.4, M0.5 | M |

### Phase 4 — Hardening, i18n, docs, e2e

| ID | Task | Depends | Size |
|----|------|---------|------|
| M4.1 | Performance/memory pass with the real Sunset file via the harness: batch sizes, progress cadence, peak RSS; document `MNY_IMPORT_LIMIT_MB` + helm memory guidance. Acceptance: 37k transactions + 68k prices < 3 min end-to-end; peak RSS < 3x file size; numbers recorded in docs | M2.4 | M |
| M4.2 | Failure-path hardening: corrupt file, truncated upload, pod kill mid-import (reaper + retry), staged-file expiry mid-wizard, double-start guard. Every failure has a localized message and a next action | M1.7 | M |
| M4.3 | Full localization pass: all new frontend `import` keys in all 23 locales, backend error keys in all 13; parity suites green; pseudo-locale regenerated. (Single pass at acceptance, per the project i18n workflow) | M1–M3 UI final | M |
| M4.4 | Playwright e2e: upload `money2001.mny` through the full wizard, plus the passworded variant; accept-string assertions finalized | M1.9 | M |
| M4.5 | Docs: `docs/import-ms-money.md` user guide (incl. v1 limitations: no merge/dedupe, FX cost-basis caveat); adopt PR #192's `ms-money-data-model.md` into `docs/` with attribution and the corrections from this design (act table, phantom rule, SEC_SPLIT); README feature bullet; release notes; close/supersede PR #192 and issue #173 with pointers and credit | all | S |
| M4.6 | Optional stretch: one-time offline generation (jackcess-encrypt, never in the build) of a tiny purpose-built fixture exercising transfer splits, act 4/15/16 pairing, SEC_SPLIT, bills; commit as `synthetic-edge.mny` with a driving integration spec. Skip if impractical | M0.1 | M |

Dependency spine: M0.2 -> M0.3 -> M0.4 -> {M0.5, M1.3}; M1.x converge on M1.8/M1.9; Phases 2 and
3 parallelize after M1.8; Track B is fully parallel. Each phase leaves `main` shippable — the
wizard simply gains capability per phase.

## 10. Test strategy

- **Layer boundary is the strategy**: only `msisam-decrypt` and the reader layer need real `.mny`
  bytes (jackcess fixtures). Mappers and writers operate on typed row objects — loan splits, act
  pairing, symbol collisions, bill filtering are all plain-object unit fixtures. This is what
  makes the coverage gates (backend 95/94/95/85, frontend 91/90/87/85) reachable.
- **Phase 0**: decrypt specs across all five fixtures (both passworded, one wrong-password);
  reader specs assert table lists, row counts, and the per-version column matrix; date
  normalization property tests (day-00 sentinel, pivot boundaries if still relevant, `YYYY-MM-DD`
  output per the repo DATE convention).
- **Phase 1**: mapper unit specs (every `at` value, phantom rule, transfer/loan-split scenarios,
  referenced-only filtering); controller contract specs (multer limits, password taxonomy, no
  password echo); job concurrency specs (double-claim, reaper); writer integration spec on the
  backend Postgres harness importing `money2008.mny` and asserting balances equal parser-computed
  values; the QIF regression suite guards the `postImportProcessing` extraction; frontend Vitest
  mirrors `MultiAccountReviewStep` test patterns.
- **Phase 2**: per-act-code fixtures; 15/16 pairing and SEC_SPLIT specs; LOT cross-check
  (agreeing + seeded-mismatch); integration spec asserting `HoldingsService` output equals
  LOT-derived holdings; price-dedupe determinism; 68k-price batch performance smoke.
- **Phase 3**: table-driven bill-filter specs over the `st`/date matrix from M0.6; Money 2001
  absence; frequency mapping incl. downgrade warnings.
- **Phase 4**: Playwright e2e with the committed Money 2001 fixture (smallest) through
  upload -> review -> import -> verification, plus the password variant; chaos/failure
  integration specs; i18n parity suites.
- **Acceptance for the feature as a whole**: the M0.5 harness run on the maintainer's real Sunset
  file and the Money 2001 file from the PR thread reports **all per-account deltas zero or
  explained** (each non-zero delta traced to a documented limitation).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Plan A decryption fails on some vintages (old-encryption or MD5-flag files) | Fixtures span 2001–2008; Plan B is a local codec patch in the vendored reader; Phase 0 is a hard gate before dependent work starts |
| Vendored mdb-reader has gaps on MSISAM-specific structures or very large files (usage maps, long-value pages) | M0.5 runs the real 200 MB-class Sunset file before Phase 1 begins; vendoring allows surgical patches; upstream issues filed as found |
| Undocumented act codes in the wild | Unknown acts are skipped with counted warnings in the report, never guessed; harness surfaces them from real files in Phase 0 |
| BILL `st` semantics guessed wrong | The wizard's bill checkbox list is the safety net — users confirm the selection; M0.6 validates against known ground truth first |
| One long import transaction (locks/bloat under concurrent use) | v1 targets fresh/wiped profiles; if harness timing demands it, split into a transaction per phase (reference data / transactions / investments / bills) as a contained follow-up |
| Vendored code drift vs upstream | `VENDORING.md` with version pin and zero-diff policy; upstreaming the MSISAM codec is the exit path |
| Coverage/lint gates vs vendor code | Exclusions land in the same PR as the vendor copy (M0.3) |

## 12. Open questions (owner: Phase 0 spike, M0.6, unless noted)

1. `DHD` base-currency field name/shape.
2. `CAT` income/expense signal: explicit flag, root-ancestor classification, or transaction-sign
   heuristic (fallback order to be established empirically).
3. Exact `BILL.st` active values, and whether BILL rows are series or instances (drives the
   dedupe key). Ground truth: kenlasko's file must yield ~20 active candidates.
4. act=5 vs act=3 distinction, act=14 real-world meaning (defaults chosen: REINVEST /
   CAPITAL_GAIN + warning).
5. Whether mdb-reader's native Jet datetime decoding fully obsoletes the MM/DD/YY 70-year-pivot
   logic (expected yes — that pivot was an artifact of mdbtools CSV output).
6. Product (decided here, revisit in review): per-account currency override offered in the review
   step (yes — cheap); closed accounts included by default (yes).
7. Deferred product questions, documented as limitations: merge/dedupe into populated profiles;
   `.mbf` backup support; act=14 category inference.

## 13. References

- PR #192 (`poc/import-from-dotmny`) and its comment thread; issue #173 — the requirements
  source, tester feedback, and the `ms-money-data-model.md` schema reference (marksimpson).
- `mdb-reader` (npm, MIT) — Jet/ACE reader with MSISAM format detection:
  https://github.com/andipaetzold/mdb-reader
- jackcess / jackcess-encrypt (Apache-2.0) — MSISAM crypt algorithm reference
  (`MSISAMCryptCodecHandler`) and the `.mny` sample fixtures:
  https://github.com/jahlborn/jackcessencrypt
- sunriise (hung-le) — the Java exporter the PoC shelled out to; useful cross-reference for
  format behavior: https://github.com/hung-le/sunriise2-misc
- In-repo: `docs/future-plans/row-level-security-tasks.md` (task-list conventions this document
  follows), `ms_money_portfolio_columns.md` (Money Portfolio Manager column semantics),
  `backend/src/import/` (wizard/import architecture being extended).
