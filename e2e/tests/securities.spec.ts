import { test, expect } from '../fixtures';
import { createSecurity } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Full CRUD matrix for Securities (the catalog of stocks/ETFs/funds a user
// tracks). Preconditions seeded via the API; behaviour driven through the UI
// and re-checked after reload to prove persistence. The list defaults to the
// "active" status filter, and a fresh security is active, so seeded rows show
// without changing the filter. Rows are scoped by their unique seeded name.
test.describe('Securities', () => {
  test('creates a security through the UI', async ({ authedPage: page }) => {
    const symbol = `Z${uniqueId().slice(-5).toUpperCase()}`;
    const name = `E2E Create ${uniqueId()}`;

    await page.goto('/securities');
    await page.getByRole('button', { name: '+ New Security' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Symbol').fill(symbol);
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create Security' }).click();

    await expect(page.locator('tr', { hasText: name })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: name })).toBeVisible();
  });

  test('lists securities seeded via the API', async ({ authedPage: page, api }) => {
    const a = await createSecurity(api, { name: `Apple-ish ${uniqueId()}` });
    const b = await createSecurity(api, { name: `Bond-ish ${uniqueId()}` });

    await page.goto('/securities');

    await expect(page.locator('tr', { hasText: a.name })).toBeVisible();
    await expect(page.locator('tr', { hasText: b.name })).toBeVisible();
  });

  test('edits a security through the UI', async ({ authedPage: page, api }) => {
    const security = await createSecurity(api, { name: `Edit Me ${uniqueId()}` });
    const newName = `Edited ${uniqueId()}`;

    await page.goto('/securities');
    await page
      .locator('tr', { hasText: security.symbol })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(newName);
    await dialog.getByRole('button', { name: 'Update Security' }).click();

    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
    await page.reload();
    await expect(page.locator('tr', { hasText: newName })).toBeVisible();
  });

  test('deletes an unused security through the UI', async ({ authedPage: page, api }) => {
    // Delete is only offered for securities with no holdings and no
    // transactions; a freshly seeded one qualifies.
    const security = await createSecurity(api, { name: `Delete Me ${uniqueId()}` });

    await page.goto('/securities');
    await page
      .locator('tr', { hasText: security.symbol })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(page.locator('tr', { hasText: security.symbol })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('tr', { hasText: security.symbol })).toHaveCount(0);
  });

  test('deactivates a security to hide it from the active list', async ({
    authedPage: page,
    api,
  }) => {
    const security = await createSecurity(api, { name: `Deactivate Me ${uniqueId()}` });

    await page.goto('/securities');
    await page
      .locator('tr', { hasText: security.symbol })
      .getByRole('button', { name: 'Deactivate', exact: true })
      .click();

    // The default filter is "active", so a deactivated security drops out.
    await expect(page.locator('tr', { hasText: security.symbol })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('tr', { hasText: security.symbol })).toHaveCount(0);
  });

  test('rejects a security with no symbol', async ({ authedPage: page }) => {
    await page.goto('/securities');
    await page.getByRole('button', { name: '+ New Security' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(`No Symbol ${uniqueId()}`);
    await dialog.getByRole('button', { name: 'Create Security' }).click();

    await expect(dialog.getByText(/symbol is required/i)).toBeVisible();
  });
});
