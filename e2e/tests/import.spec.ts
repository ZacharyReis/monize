import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createAccount, createCategory, createTransaction } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

/** Minimal single-transaction OFX bank statement (SGML, not XML). Tags are
 *  inline without closing tags for leaf values -- the parser's regex-based
 *  `getTagValue` stops at the next `<`, so this compact form round-trips the
 *  same as a fully-newlined file. */
function buildOfx(opts: { date: string; amount: number; fitid: string; name: string }): string {
  return [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    '',
    '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>',
    '<BANKTRANLIST>',
    `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${opts.date}<TRNAMT>${opts.amount}`,
    `<FITID>${opts.fitid}<NAME>${opts.name}</STMTTRN>`,
    '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
  ].join('\n');
}

interface ListedTransaction {
  amount: number | string;
  status: string;
  payeeName: string | null;
  categoryId: string | null;
}

/** Drives upload -> select account -> review -> import for a single OFX
 *  buffer against an already-known destination account. Mirrors the QIF
 *  spec above; reused by the match-review specs, which each re-run it. */
async function importOfxIntoAccount(
  page: Page,
  accountId: string,
  ofx: string,
  fileName: string,
): Promise<void> {
  await page.goto('/import');
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(ofx),
  });

  await expect(
    page.getByRole('heading', { name: /select destination account/i }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByLabel(/import into account/i).selectOption({ value: accountId });
  await page.getByRole('button', { name: /^next$/i }).click();

  await expect(
    page.getByRole('heading', { name: /review import/i }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /import transactions/i }).click();
}

test.describe('Import Transactions', () => {
  test('navigates to the import page', async ({ authedPage: page }) => {
    await page.goto('/import');
    await expect(page.locator('body')).toContainText(/import transactions/i);
  });

  test('shows the upload step by default', async ({ authedPage: page }) => {
    await page.goto('/import');

    await expect(
      page.getByText(/upload transaction files/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/select one or more files to import/i).first(),
    ).toBeVisible();
  });

  test('shows the multi-format file input', async ({ authedPage: page }) => {
    await page.goto('/import');

    await expect(
      page.getByText(/upload transaction files/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('input[type="file"][accept=".qif,.ofx,.qfx,.csv"]'),
    ).toBeAttached();
  });

  test('imports a QIF file end to end', async ({ authedPage: page, api }) => {
    const account = await createAccount(api, { name: `Import Target ${uniqueId()}` });
    // Minimal QIF bank file: one uncategorized transaction (no category lines,
    // so the wizard skips the mapping steps). Day 25 > 12 forces MM/DD/YYYY.
    const qif = ['!Type:Bank', 'D05/25/2026', 'T-42.00', 'PE2E Imported Payee', '^', ''].join('\n');

    await page.goto('/import');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-import.qif',
      mimeType: 'text/plain',
      buffer: Buffer.from(qif),
    });

    // Server parses the file, then the wizard advances to account selection.
    await expect(
      page.getByRole('heading', { name: /select destination account/i }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByLabel(/import into account/i).selectOption({ value: account.id });
    await page.getByRole('button', { name: /^next$/i }).click();

    // Review -> import.
    await expect(
      page.getByRole('heading', { name: /review import/i }),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /import transactions/i }).click();

    // Completion summary reports one imported transaction.
    await expect(
      page.getByRole('heading', { name: /import complete/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator('li', { hasText: /imported:/i })).toContainText('1');
  });

  test.describe('import match review', () => {
    // The match-review step (MatchReviewStep/MatchReviewCard) renders no
    // dedicated heading -- the wizard's only persistent title is the page-level
    // "Import Transactions" header. The card's "Merge"/"Keep both"/"Dismiss"
    // action buttons are therefore the stable, unique markers that the step
    // has mounted; each spec waits on the one relevant to its flow instead of
    // a nonexistent "Review matches" heading.

    test('merge folds the bank row into the pending transaction, keeps the user payee and category, and dedups a re-import', async ({
      authedPage: page,
      api,
    }) => {
      const account = await createAccount(api, { name: `Match ${uniqueId()}` });
      const category = await createCategory(api, { name: `E2E Match Category ${uniqueId()}` });
      await createTransaction(api, {
        accountId: account.id,
        amount: -11.04,
        transactionDate: '2026-07-02',
        payeeName: 'Google',
        status: 'UNRECONCILED',
        categoryId: category.id,
      });

      const ofx = buildOfx({
        date: '20260702',
        amount: -11.04,
        fitid: '2026070200000110401',
        name: 'GOOGLE CLOUD',
      });

      await importOfxIntoAccount(page, account.id, ofx, 'match.ofx');

      // Review-matches step: the card's primary action button is the marker.
      await expect(page.getByRole('button', { name: /^merge$/i })).toBeVisible({
        timeout: 15000,
      });
      await page.getByRole('button', { name: /^merge$/i }).click();
      // Merge is confirm-guarded (Task 8): the real merge fires from the
      // confirm button INSIDE the dialog, not the card's initial click --
      // scope to the dialog so this never depends on DOM/portal ordering.
      await page.getByRole('dialog').getByRole('button', { name: /^merge$/i }).click();
      // The card only clears itself once the merge POST resolves (MatchReviewList
      // marks it resolved after the awaited action succeeds) -- wait for that
      // signal before reading the DB, otherwise the API read can race the write.
      await expect(page.getByText(/all caught up/i)).toBeVisible({ timeout: 10000 });

      const afterMerge = await api.get<{ data: ListedTransaction[] }>(
        `/transactions?accountId=${account.id}`,
      );
      const mergedMatches = afterMerge.data.filter((t) => Number(t.amount) === -11.04);
      // No duplicate: exactly one row for this account+amount.
      expect(mergedMatches).toHaveLength(1);
      const merged = mergedMatches[0];
      expect(merged.status).toBe('CLEARED');
      // Merge keeps the USER's payee, not the bank's ("GOOGLE CLOUD") -- it
      // folds the bank record into the user's row without overwriting it.
      expect(merged.payeeName).toBe('Google');
      // The seeded category survives the merge.
      expect(merged.categoryId).toBe(category.id);

      // FITID dedup is behavioral (fitid never appears on the read DTO):
      // re-import the SAME OFX and confirm the second pass is skipped, not
      // staged as a new match and not inserted as a new row.
      await importOfxIntoAccount(page, account.id, ofx, 'match.ofx');
      await expect(
        page.getByRole('heading', { name: /import complete/i }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.locator('li', { hasText: /skipped:/i })).toContainText('1');

      const afterReimport = await api.get<{ data: ListedTransaction[] }>(
        `/transactions?accountId=${account.id}`,
      );
      expect(afterReimport.data.filter((t) => Number(t.amount) === -11.04)).toHaveLength(1);
    });

    test('keep both creates a separate cleared row alongside the pending transaction', async ({
      authedPage: page,
      api,
    }) => {
      const account = await createAccount(api, { name: `KeepBoth ${uniqueId()}` });
      await createTransaction(api, {
        accountId: account.id,
        amount: -25.5,
        transactionDate: '2026-07-03',
        payeeName: 'Coffee Shop',
        status: 'UNRECONCILED',
      });

      const ofx = buildOfx({
        date: '20260703',
        amount: -25.5,
        fitid: '2026070300000255001',
        name: 'COFFEE SHOP INC',
      });

      await importOfxIntoAccount(page, account.id, ofx, 'keepboth.ofx');

      await expect(page.getByRole('button', { name: /^keep both$/i })).toBeVisible({
        timeout: 15000,
      });
      await page.getByRole('button', { name: /^keep both$/i }).click();
      // Wait for the resolved-empty state before reading the DB -- the new row
      // is only guaranteed to exist once the awaited POST has completed.
      await expect(page.getByText(/all caught up/i)).toBeVisible({ timeout: 10000 });

      const txns = await api.get<{ data: ListedTransaction[] }>(
        `/transactions?accountId=${account.id}`,
      );
      const rows = txns.data.filter((t) => Number(t.amount) === -25.5);
      // Two rows afterward: the manual UNRECONCILED row plus a new CLEARED one.
      expect(rows).toHaveLength(2);
      expect(rows.some((t) => t.status === 'UNRECONCILED')).toBe(true);
      expect(rows.some((t) => t.status === 'CLEARED')).toBe(true);
    });

    test('dismiss rejects the match, leaving the pending transaction unchanged and the review queue empty', async ({
      authedPage: page,
      api,
    }) => {
      const account = await createAccount(api, { name: `Dismiss ${uniqueId()}` });
      await createTransaction(api, {
        accountId: account.id,
        amount: -8.75,
        transactionDate: '2026-07-04',
        payeeName: 'Snack Bar',
        status: 'UNRECONCILED',
      });

      const ofx = buildOfx({
        date: '20260704',
        amount: -8.75,
        fitid: '2026070400000087501',
        name: 'SNACK BAR LTD',
      });

      await importOfxIntoAccount(page, account.id, ofx, 'dismiss.ofx');

      await expect(page.getByRole('button', { name: /^dismiss$/i })).toBeVisible({
        timeout: 15000,
      });
      await page.getByRole('button', { name: /^dismiss$/i }).click();
      // The card resolves the match locally once dismiss succeeds, replacing
      // the queue with the "all caught up" empty state.
      await expect(page.getByText(/all caught up/i)).toBeVisible();

      const txns = await api.get<{ data: ListedTransaction[] }>(
        `/transactions?accountId=${account.id}`,
      );
      const rows = txns.data.filter((t) => Number(t.amount) === -8.75);
      // Still one row: the manual UNRECONCILED transaction, unchanged.
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('UNRECONCILED');

      // Review queue empty: GET /import/matches is the same server truth that
      // backs both the nav badge count and the /import/matches page, so this
      // is a grounded (not vacuous) check of "queue empty" without depending
      // on brittle dropdown/menu interaction.
      const pending = await api.get<unknown[]>('/import/matches');
      expect(pending).toHaveLength(0);
    });
  });
});
