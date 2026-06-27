import { test, expect } from '../fixtures';
import { createAccount, createTransaction } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Reconciliation is a setup -> reconcile -> complete flow. The end-to-end test
// seeds a CLEARED transaction whose amount matches the statement balance: the
// reconcile step pre-selects cleared transactions, so the difference is zero
// and Finish is enabled.
test.describe('Reconciliation', () => {
  test('navigates to the reconcile page', async ({ authedPage: page }) => {
    await page.goto('/reconcile');
    await expect(page.locator('body')).toContainText(/reconcile account/i);
  });

  test('shows the setup step fields', async ({ authedPage: page }) => {
    await page.goto('/reconcile');

    await expect(
      page.getByText(/start reconciliation/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel(/^account$/i).first()).toBeVisible();
    await expect(page.getByLabel(/statement date/i).first()).toBeVisible();
    await expect(page.getByLabel(/statement ending balance/i).first()).toBeVisible();
  });

  test('reconciles an account end to end', async ({ authedPage: page, api }) => {
    const account = await createAccount(api, { openingBalance: 0 });
    await createTransaction(api, {
      accountId: account.id,
      amount: 100,
      payeeName: `Recon ${uniqueId()}`,
      status: 'CLEARED',
    });

    await page.goto('/reconcile');
    await expect(
      page.getByText(/start reconciliation/i).first(),
    ).toBeVisible({ timeout: 10000 });

    await page.getByLabel(/^account$/i).first().selectOption({ value: account.id });
    await page.getByLabel(/statement ending balance/i).first().fill('100');
    await page.getByRole('button', { name: /start reconciliation/i }).click();

    // Cleared transaction is pre-selected -> difference is zero -> Finish enabled.
    const finish = page.getByRole('button', { name: /finish reconciliation/i });
    await expect(finish).toBeEnabled({ timeout: 10000 });
    await finish.click();

    await expect(page.getByText(/reconciliation complete/i)).toBeVisible();
  });

  test('shows a cancel button on setup', async ({ authedPage: page }) => {
    await page.goto('/reconcile');

    await expect(
      page.getByText(/start reconciliation/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });
});
