import { test, expect } from '../fixtures';

// Admin surface. The admin is registered as the very first user in global setup
// (first user => admin role) and lives in its own browser context via the
// adminPage fixture. User create/disable/role-change go through a multi-step
// modal and are deferred (see ROADMAP Phase 3.3); this covers the access
// boundary and the user-management listing.
test.describe('Admin', () => {
  test('admin sees the user management page and the user list', async ({
    adminPage,
    adminUser,
  }) => {
    await adminPage.goto('/admin/users');

    await expect(
      adminPage.getByRole('heading', { name: 'User Management' }),
    ).toBeVisible({ timeout: 15000 });
    // The admin's own account appears in the managed-user list.
    await expect(adminPage.getByText(adminUser.email)).toBeVisible();
  });

  test('a non-admin is redirected away from /admin/users', async ({
    authedPage: page,
  }) => {
    await page.goto('/admin/users');

    // The page redirects non-admins to the dashboard.
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
