import { expect, test } from '@playwright/test';
import { COLLECTOR, LABELS, SALES_MANAGER, mainNav, open, signIn } from './demo';

/**
 * The deployment's identity and the redesign's visible guarantees, against the built application,
 * the built API and the real demonstration data.
 *
 * - The company shown is the configured one (ALOLA), read from the company profile at runtime — and
 *   the superseded demonstration identity appears nowhere a person looks.
 * - Account references render as people, never as `acc_…`.
 * - Enumerations render as words, never as raw translation keys.
 */
const ALOLA_AR = 'شركة العلا للتطوير العقاري';
const ALOLA_EN = 'ALOLA Developments';
const SUPERSEDED = /دار المستقبل|Future House/;

test.describe('the company identity', () => {
  test('is on the sign-in screen, from configuration', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(ALOLA_AR).first()).toBeVisible();
    await expect(page.getByText('نظام إدارة التطوير العقاري').first()).toBeVisible();
    await expect(page).toHaveTitle('العلا');
    await expect(page.getByText(SUPERSEDED)).toHaveCount(0);
  });

  test('heads the sidebar in both languages', async ({ page }) => {
    await signIn(page, SALES_MANAGER);
    await mainNav(page);
    await expect(page.getByText(ALOLA_AR).first()).toBeVisible();
    if (await page.getByRole('button', { name: LABELS.ar.openNavigation }).isVisible()) {
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: LABELS.ar.switchTo }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await mainNav(page);
    await expect(page.getByText(ALOLA_EN).first()).toBeVisible();
  });

  test('names the legal entity in Organization, with no trace of the superseded name', async ({
    page,
  }) => {
    await signIn(page, SALES_MANAGER);
    await open(page, '/organization');
    await expect(page.getByText(ALOLA_AR).first()).toBeVisible();
    await expect(page.getByText(SUPERSEDED)).toHaveCount(0);
  });
});

test.describe('what a screen never shows', () => {
  test('an account reference instead of a person', async ({ page }) => {
    await signIn(page, SALES_MANAGER);
    await open(page, '/leads');
    await expect(page.getByText('منى عبد الرحمن').first()).toBeVisible();
    // Names resolve after the list; wait for the lookup to settle before asserting absence.
    await expect(page.locator('[data-person="loading"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('main')).not.toContainText(/acc_[A-Za-z0-9]/);
  });

  test('a raw translation key for a receipt state', async ({ page }) => {
    await signIn(page, COLLECTOR);
    await open(page, '/receipts');
    await expect(page.getByText(/^RCT-\d{4}-\d{5}$/).first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText('receiptState.');
    await expect(page.locator('[data-tone]').first()).toBeVisible();
  });
});
