import { test, expect } from '../fixtures';
import { createAccount } from '../helpers/factories';
import { uniqueId } from '../helpers/api';

// Backup & restore. Export downloads a gzipped JSON of all the user's data (no
// password prompt unless encrypted backups are enabled, which they are not by
// default). The restore round-trip wipes and replaces all data; driving it
// end-to-end in a browser is deferred (see ROADMAP Phase 3.4) -- the wipe
// appears to invalidate the active session, so asserting the restored data in
// the same page session isn't reliable. Restore is covered by backend tests.
test.describe('Backup & restore', () => {
  test('exports a backup file', async ({ authedPage: page, api }) => {
    await createAccount(api, { name: `Backup ${uniqueId()}` });

    await page.goto('/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/monize-backup.*\.(json\.gz|gz)/);
  });
});
