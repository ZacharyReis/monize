import { test, expect } from '../fixtures';
import { createCategory } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Full CRUD matrix for Categories. Preconditions seeded via the API; behaviour
// driven through the UI and re-checked after reload to prove persistence.
test.describe('Categories', () => {
  test('creates a category through the UI', async ({ authedPage: page }) => {
    const name = `E2E Create ${uniqueId()}`;

    await page.goto('/categories');
    await page.getByRole('button', { name: /new category/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/category name/i).fill(name);
    await dialog.getByRole('button', { name: /create category/i }).click();

    await expect(page.locator('tr', { hasText: name })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: name })).toBeVisible();
  });

  test('lists categories seeded via the API', async ({ authedPage: page, api }) => {
    const expense = await createCategory(api, { name: `Groceries ${uniqueId()}` });
    const income = await createCategory(api, {
      name: `Salary ${uniqueId()}`,
      isIncome: true,
    });

    await page.goto('/categories');

    await expect(page.locator('tr', { hasText: expense.name })).toBeVisible();
    await expect(page.locator('tr', { hasText: income.name })).toBeVisible();
  });

  test('edits a category through the UI', async ({ authedPage: page, api }) => {
    const category = await createCategory(api, { name: `Edit Me ${uniqueId()}` });
    const newName = `Edited ${uniqueId()}`;

    await page.goto('/categories');
    await page
      .locator('tr', { hasText: category.name })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/category name/i).fill(newName);
    await dialog.getByRole('button', { name: /update category/i }).click();

    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
    await expect(page.locator('tr', { hasText: category.name })).toHaveCount(0);
  });

  test('deletes an unused category through the UI', async ({ authedPage: page, api }) => {
    const category = await createCategory(api, { name: `Delete Me ${uniqueId()}` });

    await page.goto('/categories');
    await page
      .locator('tr', { hasText: category.name })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    // The delete dialog checks usage async, then enables its Delete button
    // (click auto-waits for it to become enabled).
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(page.locator('tr', { hasText: category.name })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('tr', { hasText: category.name })).toHaveCount(0);
  });

  test('rejects an empty category name', async ({ authedPage: page }) => {
    await page.goto('/categories');
    await page.getByRole('button', { name: /new category/i }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /create category/i }).click();

    await expect(dialog.getByText(/category name is required/i)).toBeVisible();
  });
});
