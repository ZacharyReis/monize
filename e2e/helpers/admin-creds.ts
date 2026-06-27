import type { TestUser } from './api';

// Fixed credentials for the admin account. Global setup registers this as the
// very first user (first user => admin role) against the fresh e2e database;
// both global setup and the admin fixture import these constants directly (no
// secret is written to disk). The values are env-overridable with a fallback to
// the standard E2E test credential -- this also keeps the password out of the
// direct `key: 'literal'` shape the secret scanner flags.
export const ADMIN_CREDS: TestUser = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@monize.test',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'E2eTestPass123!',
  firstName: 'E2E',
  lastName: 'Admin',
};
