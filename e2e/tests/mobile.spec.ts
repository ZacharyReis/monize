import { test, expect } from '../fixtures';
import { uniqueId } from '../helpers/api';

// Responsive / mobile-viewport pass. The nav collapses on small screens, so
// these reach pages by direct navigation and then exercise a primary flow to
// prove the page and its modal are usable at phone width. Phase 1 was bitten by
// breakpoint-hidden duplicate nav buttons, hence the `.first()` discipline.
test.use({ viewport: { width: 390, height: 844 } });

test.describe('Mobile viewport', () => {
  test('renders the dashboard', async ({ authedPage: page }) => {
    await page.goto('/dashboard');

    await expect(page.getByText('Net Worth').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('creates an account from the accounts page', async ({ authedPage: page }) => {
    const name = `Mobile Acct ${uniqueId()}`;

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
});
