import { test, expect } from '../fixtures';

// The poetic finale: this is the one suite that actually destroys an account.
// It is named to sort last so it runs after everything else (the CI runner is
// sequential, single-worker). Each test still uses its own fresh, disposable
// user, so the deletion only ever removes data this test created.
test.describe('Danger zone -- account deletion (runs last)', () => {
  test('deletes the account and blocks re-login', async ({
    authedPage: page,
    user,
  }) => {
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: /danger zone/i }),
    ).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Delete Account' }).click();

    // Confirmation requires typing DELETE and re-entering the password.
    await page.getByPlaceholder('Type DELETE').fill('DELETE');
    await page.getByPlaceholder('Enter your password').fill(user.password);
    await page.getByRole('button', { name: 'Confirm Delete' }).click();

    // Deletion logs the user out and returns to /login.
    await page.waitForURL(/\/login/, { timeout: 15000 });

    // We're done here: the credentials no longer authenticate.
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
