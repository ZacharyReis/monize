import { test, expect } from '../fixtures';
import { createAccount, createCustomReport } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Reports, insights, and the dashboard net-worth roll-up. The built-in report
// catalogue is static, so the list/open coverage is deterministic. The custom
// report builder and Monte-Carlo projection are deferred (see ROADMAP Phase
// 2.3); this asserts the catalogue, opening a report, the net-worth surface,
// and the insights page.
test.describe('Reports & analytics', () => {
  test('lists the built-in report catalogue', async ({ authedPage: page }) => {
    await page.goto('/reports');

    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByText('Spending by Category').first()).toBeVisible();
    await expect(page.getByText('Income vs Expenses').first()).toBeVisible();
    await expect(page.getByText('Net Worth Over Time').first()).toBeVisible();
  });

  test('opens a built-in report', async ({ authedPage: page }) => {
    await page.goto('/reports');

    // Report cards are buttons whose accessible name includes the report title.
    await page
      .getByRole('button', { name: /Spending by Category/i })
      .first()
      .click();

    // Lands on the report's own route, whose header echoes the report name.
    await page.waitForURL(/\/reports\/spending-by-category/);
    await expect(
      page.getByRole('heading', { name: 'Spending by Category' }),
    ).toBeVisible();
  });

  test('renders the net-worth report', async ({ authedPage: page }) => {
    await page.goto('/reports/net-worth');

    await expect(
      page.getByRole('heading', { name: 'Net Worth Over Time' }),
    ).toBeVisible({ timeout: 15000 });
  });

  test('renders the Monte-Carlo simulation report', async ({ authedPage: page }) => {
    // The heavy projection component is lazy-loaded under Suspense; the route's
    // header renders immediately, so this is a deterministic render smoke.
    // Driving the projection inputs is deferred (see ROADMAP Phase 2.3).
    await page.goto('/reports/monte-carlo-simulation');

    await expect(
      page.getByRole('heading', { name: 'Monte Carlo Simulation' }),
    ).toBeVisible({ timeout: 15000 });
  });

  test('shows a net-worth surface on the dashboard', async ({
    authedPage: page,
    api,
  }) => {
    // Seed an asset and a liability so net worth has something to roll up.
    await createAccount(api, {
      name: `Savings ${uniqueId()}`,
      accountType: 'SAVINGS',
      openingBalance: 5000,
    });
    await createAccount(api, {
      name: `Chequing ${uniqueId()}`,
      accountType: 'CHEQUING',
      openingBalance: 800,
    });

    await page.goto('/dashboard');

    await expect(page.getByText('Net Worth').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('renders the insights page', async ({ authedPage: page }) => {
    await page.goto('/insights');

    await expect(
      page.getByRole('heading', { name: 'Spending Insights' }),
    ).toBeVisible();
  });

  test('opens a seeded custom report', async ({ authedPage: page, api }) => {
    const report = await createCustomReport(api, { name: `Custom ${uniqueId()}` });

    await page.goto(`/reports/custom/${report.id}`);

    await expect(page.getByRole('heading', { name: report.name })).toBeVisible({
      timeout: 15000,
    });
  });

  test('creates a custom report through the builder', async ({ authedPage: page }) => {
    // Only the name is required; every other builder field defaults. On save
    // the app routes to the new report's viewer, whose header echoes the name.
    const name = `Built ${uniqueId()}`;

    await page.goto('/reports/custom/new');
    await page.getByLabel('Report Name').fill(name);
    await page.getByRole('button', { name: 'Create Report' }).click();

    await page.waitForURL(/\/reports\/custom\/[\w-]+$/);
    await expect(page.getByRole('heading', { name })).toBeVisible({
      timeout: 15000,
    });
  });
});
