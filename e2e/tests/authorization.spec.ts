import { test, expect } from '../fixtures';

// Cross-cutting authorization: every protected route must bounce an
// unauthenticated visitor to /login (defense in depth on top of the backend's
// guards). These use the base `page` fixture, so no user is registered and the
// browser carries no auth cookies.
const protectedRoutes = [
  '/dashboard',
  '/accounts',
  '/transactions',
  '/budgets',
  '/investments',
  '/securities',
  '/reports',
  '/insights',
  '/settings',
  '/categories',
  '/payees',
  '/tags',
  '/currencies',
  '/bills',
];

test.describe('Authorization (unauthenticated)', () => {
  for (const route of protectedRoutes) {
    test(`redirects ${route} to login`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(/\/login/, { timeout: 15000 });
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
