import { test, expect } from '../fixtures';
import { logout, loginUser } from '../helpers/auth';
import { uniqueId } from '../helpers/api';

// Settings: the page renders Profile, Preferences, and Security on one
// scrolling page. The smoke tests assert the sections render; the deeper tests
// drive profile/preferences/password edits and prove persistence after reload
// (and, for the password, a successful re-login with the new credentials).
test.describe('Settings', () => {
  test('shows all major setting sections on one page', async ({ authedPage: page }) => {
    await page.goto('/settings');

    // Assert section headings rather than the duplicated, breakpoint-hidden
    // nav labels of the same name.
    await expect(
      page.getByRole('heading', { name: 'Preferences', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole('heading', { name: 'Security', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /danger zone/i }),
    ).toBeVisible();
  });

  test('updates the profile name and persists it after reload', async ({
    authedPage: page,
  }) => {
    const newName = `Renamed${uniqueId().slice(-5)}`;

    await page.goto('/settings');
    const firstName = page.getByLabel('First Name', { exact: true });
    await expect(firstName).toBeVisible({ timeout: 15000 });
    await firstName.fill(newName);
    await page.getByRole('button', { name: 'Save Profile' }).click();

    await expect(page.getByText(/profile updated successfully/i)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('First Name', { exact: true })).toHaveValue(
      newName,
    );
  });

  test('changes the default currency and persists it after reload', async ({
    authedPage: page,
  }) => {
    await page.goto('/settings');
    const currency = page.getByLabel('Default Currency');
    await expect(currency).toBeVisible({ timeout: 15000 });
    // GBP is part of the seeded currency catalog (see currencies.spec).
    await currency.selectOption('GBP');
    await page.getByRole('button', { name: /save preferences/i }).click();

    await expect(page.getByText(/preferences saved/i)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Default Currency')).toHaveValue('GBP');
  });

  test('changes the password and re-logs in with the new one', async ({
    authedPage: page,
    user,
  }) => {
    const newPassword = `NewE2ePass456!${uniqueId().slice(-4)}`;

    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Security', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Current Password', { exact: true }).fill(user.password);
    await page.getByLabel('New Password', { exact: true }).fill(newPassword);
    await page
      .getByLabel('Confirm New Password', { exact: true })
      .fill(newPassword);
    await page.getByRole('button', { name: 'Change Password' }).click();

    await expect(page.getByText(/password changed successfully/i)).toBeVisible();

    // The old session is still valid; prove the new password works end to end.
    await logout(page);
    await loginUser(page, user.email, newPassword);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('rejects a wrong current password', async ({ authedPage: page }) => {
    const newPassword = `NewE2ePass456!${uniqueId().slice(-4)}`;

    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Security', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page
      .getByLabel('Current Password', { exact: true })
      .fill('TotallyWrong123!');
    await page.getByLabel('New Password', { exact: true }).fill(newPassword);
    await page
      .getByLabel('Confirm New Password', { exact: true })
      .fill(newPassword);
    await page.getByRole('button', { name: 'Change Password' }).click();

    await expect(page.getByText(/current password is incorrect/i)).toBeVisible();
  });

  test('rejects a too-weak new password', async ({ authedPage: page, user }) => {
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Security', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Current Password', { exact: true }).fill(user.password);
    await page.getByLabel('New Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm New Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Change Password' }).click();

    // Client-side zod validation blocks the request.
    await expect(
      page.getByText(/password must be at least 12 characters/i),
    ).toBeVisible();
  });
});
