import { test, expect } from '../fixtures';
import { createPayee } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Full CRUD matrix for Payees. Preconditions seeded via the API; behaviour
// driven through the UI and re-checked after reload to prove persistence.
test.describe('Payees', () => {
  test('creates a payee through the UI', async ({ authedPage: page }) => {
    const name = `E2E Create ${uniqueId()}`;

    await page.goto('/payees');
    await page.getByRole('button', { name: /new payee/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/payee name/i).fill(name);
    await dialog.getByRole('button', { name: /create payee/i }).click();

    await expect(page.locator('tr', { hasText: name })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: name })).toBeVisible();
  });

  test('lists payees seeded via the API', async ({ authedPage: page, api }) => {
    const landlord = await createPayee(api, { name: `Landlord ${uniqueId()}` });
    const employer = await createPayee(api, { name: `Employer ${uniqueId()}` });

    await page.goto('/payees');

    await expect(page.locator('tr', { hasText: landlord.name })).toBeVisible();
    await expect(page.locator('tr', { hasText: employer.name })).toBeVisible();
  });

  test('edits a payee through the UI', async ({ authedPage: page, api }) => {
    const payee = await createPayee(api, { name: `Edit Me ${uniqueId()}` });
    const newName = `Edited ${uniqueId()}`;

    await page.goto('/payees');
    await page
      .locator('tr', { hasText: payee.name })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/payee name/i).fill(newName);
    await dialog.getByRole('button', { name: /update payee/i }).click();

    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
    await expect(page.locator('tr', { hasText: payee.name })).toHaveCount(0);
  });

  test('deletes a payee through the UI', async ({ authedPage: page, api }) => {
    const payee = await createPayee(api, { name: `Delete Me ${uniqueId()}` });

    await page.goto('/payees');
    await page
      .locator('tr', { hasText: payee.name })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(page.locator('tr', { hasText: payee.name })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('tr', { hasText: payee.name })).toHaveCount(0);
  });

  test('rejects an empty payee name', async ({ authedPage: page }) => {
    await page.goto('/payees');
    await page.getByRole('button', { name: /new payee/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /create payee/i }).click();

    await expect(dialog.getByText(/payee name is required/i)).toBeVisible();
  });
});
