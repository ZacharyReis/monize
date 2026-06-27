import { test, expect } from '../fixtures';
import { loginUser } from '../helpers/auth';
import { gotoStable } from '../helpers/nav';
import { createApiClient, uniqueId } from '../helpers/api';
import {
  createAccount,
  createDelegate,
  grantDelegateAccount,
} from '../helpers/factories';

// Shared access / delegation. An owner can grant another person scoped access
// to their account. The owner-side management UI lives at
// /settings/shared-access; a delegate signs in with their own credentials and
// switches into the owner's context to see only what was granted.
test.describe('Delegation (shared access)', () => {
  test('owner adds and removes a delegate', async ({ authedPage: page }) => {
    const email = `e2e-del-${uniqueId()}@test.example.com`;

    await page.goto('/settings/shared-access');
    await page.getByRole('button', { name: 'Add delegate' }).first().click();

    await page.getByPlaceholder('Delegate email').fill(email);
    // New email + no invite -> the owner sets a password directly.
    await page.getByPlaceholder('Set a password').fill('E2eTestPass123!');
    await page.getByRole('button', { name: 'Add delegate' }).last().click();

    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove', exact: true })
      .click();

    await expect(page.getByText(email)).toHaveCount(0);
  });

  test('a delegate sees an account shared with them', async ({
    authedPage: page,
    api,
    browser,
  }) => {
    const owner = await api.get<{ id: string }>('/auth/profile');
    const account = await createAccount(api, { name: `Shared ${uniqueId()}` });
    const email = `e2e-del-${uniqueId()}@test.example.com`;
    const password = 'E2eTestPass123!';
    const delegate = await createDelegate(api, { email, password });
    await grantDelegateAccount(api, delegate.id, account.id);

    // The delegate signs in from their own browser context.
    const delegateContext = await browser.newContext();
    try {
      const delegatePage = await delegateContext.newPage();
      await loginUser(delegatePage, email, password);

      // Switch into the owner's context explicitly so the server-side context
      // is deterministic. The DelegationBanner in the browser page also
      // auto-switches this single-owner delegate, and that path ends in a
      // window.location.reload() which can abort a concurrent goto with
      // net::ERR_ABORTED -- gotoStable retries past that transient reload.
      // GET /accounts is @AllowDelegate and returns granted accounts.
      const delegateApi = createApiClient(delegatePage.request);
      await delegateApi.post('/auth/switch-context', { targetUserId: owner.id });

      await gotoStable(delegatePage, '/accounts');
      await expect(
        delegatePage.locator('tr', { hasText: account.name }),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await delegateContext.close();
    }
  });
});
