import { test, expect } from '../fixtures';
import { createAccount } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Full CRUD matrix for Accounts. Preconditions seeded via the API; behaviour
// driven through the UI and re-checked after reload to prove persistence.
// Account rows navigate on body click, so we only interact with the action
// buttons (their cell stops click propagation).
test.describe('Accounts', () => {
  test('creates an account through the UI', async ({ authedPage: page }) => {
    const name = `E2E Chequing ${uniqueId()}`;

    await page.goto('/accounts');
    await page.getByRole('button', { name: /new account/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/account name/i).fill(name);
    await dialog.getByLabel(/account type/i).selectOption({ label: 'Chequing' });
    await dialog.getByRole('button', { name: /create account/i }).click();

    await expect(page.locator('tr', { hasText: name })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: name })).toBeVisible();
  });

  test('lists accounts seeded via the API', async ({ authedPage: page, api }) => {
    const chequing = await createAccount(api, {
      name: `Chequing ${uniqueId()}`,
      accountType: 'CHEQUING',
    });
    const savings = await createAccount(api, {
      name: `Savings ${uniqueId()}`,
      accountType: 'SAVINGS',
    });

    await page.goto('/accounts');

    await expect(page.locator('tr', { hasText: chequing.name })).toBeVisible();
    await expect(page.locator('tr', { hasText: savings.name })).toBeVisible();
  });

  test('edits an account through the UI', async ({ authedPage: page, api }) => {
    const account = await createAccount(api, { name: `Edit Me ${uniqueId()}` });
    const newName = `Edited ${uniqueId()}`;

    await page.goto('/accounts');
    await page
      .locator('tr', { hasText: account.name })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/account name/i).fill(newName);
    await dialog.getByRole('button', { name: /update account/i }).click();

    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
    await expect(page.locator('tr', { hasText: account.name })).toHaveCount(0);
  });

  test('deletes an unused account through the UI', async ({ authedPage: page, api }) => {
    // A zero-balance account with no transactions is permanently deletable.
    const account = await createAccount(api, { name: `Delete Me ${uniqueId()}` });

    await page.goto('/accounts');
    await page
      .locator('tr', { hasText: account.name })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: /delete account/i })
      .click();

    await expect(page.locator('tr', { hasText: account.name })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('tr', { hasText: account.name })).toHaveCount(0);
  });

  test('rejects an empty account name', async ({ authedPage: page }) => {
    await page.goto('/accounts');
    await page.getByRole('button', { name: /new account/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /create account/i }).click();

    await expect(dialog.getByText(/account name is required/i)).toBeVisible();
  });
});
