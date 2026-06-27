import { test, expect } from '../fixtures';
import { logout } from '../helpers/auth';
import { generateTotp } from '../helpers/totp';

// 2FA (TOTP) and the password-reset surfaces. FORCE_2FA is false in
// docker-compose.e2e.yml, so 2FA is opt-in per test. Enabling is done through
// the API (POST /auth/2fa/setup returns the base32 secret, confirm-setup
// promotes it) so the test owns the secret and can generate codes; the
// login-with-2FA and disable flows are then driven through the UI.
test.describe('Two-factor authentication', () => {
  async function enable2FA(
    api: { post<T = unknown>(path: string, body?: unknown): Promise<T> },
    password: string,
  ): Promise<string> {
    const { secret } = await api.post<{ secret: string }>('/auth/2fa/setup', {
      currentPassword: password,
    });
    await api.post('/auth/2fa/confirm-setup', { code: generateTotp(secret) });
    return secret;
  }

  test('reflects the enabled state in settings', async ({
    authedPage: page,
    api,
    user,
  }) => {
    await enable2FA(api, user.password);

    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Security', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole('button', { name: 'Disable 2FA' }),
    ).toBeVisible();
  });

  test('enforces a second factor at login when enabled', async ({
    authedPage: page,
    api,
    user,
  }) => {
    await enable2FA(api, user.password);

    await logout(page);
    await page.waitForURL(/\/login/);
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The security-critical property: a correct password alone does NOT grant a
    // session -- the TOTP verification step is required and we stay on /login.
    // (A successful TOTP verification is covered by the disable test below.)
    await expect(page.getByText('Two-Factor Authentication')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /use a backup code instead/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('disables 2FA from settings', async ({ authedPage: page, api, user }) => {
    const secret = await enable2FA(api, user.password);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Disable 2FA' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Verification Code').fill(generateTotp(secret));
    await dialog.getByRole('button', { name: 'Disable 2FA' }).click();

    // Back to the disabled state -- the enable affordance returns.
    await expect(page.getByRole('button', { name: 'Enable 2FA' })).toBeVisible();
  });
});

// Forgot/reset depends on email, which the e2e stack does not configure (no
// SMTP, no exposed DB), so the happy path is deferred (see ROADMAP Phase 2.4).
// The forgot-password page itself gates on SMTP and redirects to /login when
// it's unavailable -- we lock in that behaviour. The reset page guards a
// missing/invalid token (the token check runs before any email dependency).
// Uses the unauthenticated base `page`.
test.describe('Password reset', () => {
  test('forgot-password redirects to login when email is unavailable', async ({
    page,
  }) => {
    await page.goto('/forgot-password');

    // No SMTP configured -> the page bounces to /login.
    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('reset-password rejects a missing token', async ({ page }) => {
    await page.goto('/reset-password');

    await expect(
      page.getByText(/invalid or missing reset token/i),
    ).toBeVisible();
  });

  test('reset-password rejects an invalid token', async ({ page }) => {
    await page.goto('/reset-password?token=not-a-real-token');

    await page.getByLabel('New Password', { exact: true }).fill('FreshE2ePass123!');
    await page.getByLabel('Confirm Password', { exact: true }).fill('FreshE2ePass123!');
    await page.getByRole('button', { name: /reset password/i }).click();

    await expect(
      page.getByText(/invalid or expired reset token/i),
    ).toBeVisible();
  });
});
