import { test, expect } from '../fixtures';
import {
  createBudget,
  addBudgetCategory,
  createCategory,
  createAccount,
  createTransaction,
} from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Budgets. The create flow is a spending-analysis wizard (deferred -- see
// ROADMAP Phase 2.2), so budgets are seeded via the API and the UI is used to
// list, inspect actuals-vs-budget, and delete. The detail page loads a summary
// (categoryBreakdown), so each detail/delete test seeds at least one category.
test.describe('Budgets', () => {
  test('lists budgets seeded via the API', async ({ authedPage: page, api }) => {
    const a = await createBudget(api, { name: `Household ${uniqueId()}` });
    const b = await createBudget(api, { name: `Vacation ${uniqueId()}` });

    await page.goto('/budgets');

    await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
    await expect(page.getByRole('heading', { name: b.name })).toBeVisible();
  });

  test('shows actuals against the budget for the current period', async ({
    authedPage: page,
    api,
  }) => {
    const budget = await createBudget(api, { name: `Spending ${uniqueId()}` });
    const category = await createCategory(api, { name: `Groceries ${uniqueId()}` });
    await addBudgetCategory(api, budget.id, {
      categoryId: category.id,
      amount: 500,
    });

    // Seed an actual expense in that category, dated today (inside the
    // current monthly period the budget opened on).
    const account = await createAccount(api, { openingBalance: 1000 });
    await createTransaction(api, {
      accountId: account.id,
      amount: -120,
      categoryId: category.id,
    });

    await page.goto(`/budgets/${budget.id}`);

    await expect(page.getByRole('heading', { name: budget.name })).toBeVisible({
      timeout: 15000,
    });
    // The category appears with its budgeted target.
    await expect(page.getByText(category.name).first()).toBeVisible();
    await expect(page.getByText(/\$500/).first()).toBeVisible();
    // The seeded spend shows as the actual. The period summary is recomputed
    // on load, and the just-seeded transaction can occasionally miss the very
    // first render (eventual consistency between the write and the aggregate).
    // Poll: reload and re-check until the actual appears, rather than relying
    // on a single reload landing after the recompute.
    await expect(async () => {
      await page.reload();
      await expect(page.getByText(/\$120/).first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
  });

  test('deletes a budget through the UI', async ({ authedPage: page, api }) => {
    const budget = await createBudget(api, { name: `Delete Me ${uniqueId()}` });
    const category = await createCategory(api, { name: `Cat ${uniqueId()}` });
    await addBudgetCategory(api, budget.id, { categoryId: category.id, amount: 200 });

    await page.goto(`/budgets/${budget.id}`);
    await expect(page.getByRole('heading', { name: budget.name })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await page.waitForURL(/\/budgets$/);
    await expect(page.getByRole('heading', { name: budget.name })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: budget.name })).toHaveCount(0);
  });
});
