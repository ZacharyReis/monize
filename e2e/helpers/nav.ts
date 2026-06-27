import { Page } from '@playwright/test';

// A goto that tolerates an in-flight navigation being aborted by a competing
// client-side navigation. The most common source is a full-page reload kicked
// off by app code right after auth state settles -- e.g. the DelegationBanner
// auto-switching a single-owner delegate calls window.location.reload(), which
// aborts a concurrent page.goto() with net::ERR_ABORTED. The competing
// navigation settles quickly, so we wait for it to finish and re-issue the
// goto; after that the app no longer reloads and the navigation lands.
export async function gotoStable(
  page: Page,
  url: string,
  opts: { timeout?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 15000;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { timeout });
      return;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && err.message.includes('net::ERR_ABORTED')) {
        // Let the competing navigation (the reload) finish before retrying.
        await page.waitForLoadState('load').catch(() => {});
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
