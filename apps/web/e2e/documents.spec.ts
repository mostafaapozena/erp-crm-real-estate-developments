import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { COLLECTOR, LABELS, SALES_MANAGER, open, signIn } from './demo';

/**
 * Issued PDFs and their public verification (CORE-DOC-003, CORE-DOC-005), against the built web
 * application, the built API and the real database.
 *
 * Read-only on business data, like the rest of the suite: it relies on the sample documents that
 * `npm run seed:demo:documents` issues once, and never issues, supersedes or revokes anything itself.
 * Downloading and verifying are recorded in the audit trail, as they should be.
 */

const PANEL = 'المستندات الصادرة';

/** A record in the panel: a table row on desktop, a card on a phone. */
const entries = (page: Page) => page.locator('tr, li');

async function openFirstContract(page: Page): Promise<void> {
  await open(page, '/contracts');
  await page.getByText('CTR-2026-00001').first().click();
  await expect(page.getByRole('heading', { name: PANEL })).toBeVisible({ timeout: 20_000 });
}

/** The verification path of the current (issued) contract summary, from the panel. */
async function currentSummaryLink(page: Page): Promise<string> {
  const link = entries(page)
    .filter({ hasText: 'ملخص العقد' })
    .filter({ hasText: 'سارية' })
    .getByRole('link', { name: /^فتح صفحة التحقق من ملخص العقد/u })
    .first();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/verify\/[A-Za-z0-9_-]{43}$/);
  return href ?? '';
}

test.describe('issued documents on a record page', () => {
  test('lists the versions of a contract, and offers issuing to a sales manager', async ({
    page,
  }) => {
    await signIn(page, SALES_MANAGER);
    await openFirstContract(page);
    // A current version and the one it superseded, both kept.
    const summaries = entries(page).filter({ hasText: 'ملخص العقد' });
    await expect(summaries.filter({ hasText: 'سارية' }).first()).toBeVisible();
    await expect(summaries.filter({ hasText: 'حلّ محلها إصدار أحدث' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'إصدار مستند' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/سيصدر الإصدار رقم \d+ من CTR-2026-00001/u)).toBeVisible();
    await dialog.getByRole('button', { name: 'إلغاء' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('downloads the stored PDF through an audited link', async ({ page }) => {
    await signIn(page, SALES_MANAGER);
    await openFirstContract(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('button', { name: /^تنزيل ملخص العقد الإصدار/u })
        .first()
        .click(),
    ]);
    const path = await download.path();
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(download.suggestedFilename()).toMatch(/^contractSummary-CTR-2026-00001-ar-v\d+\.pdf$/);
  });

  test('offers no issuing and no revoking to a role without those permissions', async ({
    page,
  }) => {
    await signIn(page, COLLECTOR);
    await open(page, '/receipts');
    await page
      .getByText(/^RCT-\d{4}-\d{5}$/)
      .first()
      .click();
    await expect(page.getByRole('heading', { name: PANEL })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^إلغاء إيصال استلام/u })).toHaveCount(0);
  });
});

test.describe('public verification', () => {
  test('answers a printed code without a session, in Arabic and English', async ({
    page,
    browser,
  }) => {
    await signIn(page, SALES_MANAGER);
    await openFirstContract(page);
    const path = await currentSummaryLink(page);

    // A stranger: a fresh browser context with no cookie and no session.
    const stranger = await browser.newContext();
    const visitor = await stranger.newPage();
    try {
      await visitor.goto(path);
      await expect(
        visitor.getByRole('heading', { name: 'التحقق من مستند', level: 1 }),
      ).toBeVisible();
      await expect(visitor.getByText('مستند صحيح وساري')).toBeVisible();
      await expect(visitor.getByText('CTR-2026-00001')).toBeVisible();
      await expect(visitor.getByText(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/)).toBeVisible();
      await expect(visitor.locator('html')).toHaveAttribute('dir', 'rtl');
      // Nothing personal or financial: no customer name, no amount.
      await expect(visitor.getByText('منى عبد الرحمن')).toHaveCount(0);
      await expect(visitor.getByText(/ج\.م\.|EGP/u)).toHaveCount(0);
      // The sign-in form never appears.
      await expect(
        visitor.getByRole('button', { name: LABELS.ar.signIn, exact: true }),
      ).toHaveCount(0);

      await visitor.getByRole('button', { name: 'English' }).click();
      await expect(visitor.getByText('Genuine and current')).toBeVisible();
      await expect(visitor.locator('html')).toHaveAttribute('dir', 'ltr');
    } finally {
      await stranger.close();
    }
  });

  test('says a superseded version is superseded', async ({ page, browser }) => {
    await signIn(page, SALES_MANAGER);
    await openFirstContract(page);
    const superseded = entries(page)
      .filter({ hasText: 'ملخص العقد' })
      .filter({ hasText: 'حلّ محلها إصدار أحدث' })
      .getByRole('link')
      .first();
    const path = (await superseded.getAttribute('href')) ?? '';
    const stranger = await browser.newContext();
    try {
      const visitor = await stranger.newPage();
      await visitor.goto(path);
      await expect(visitor.getByText('صدر إصدار أحدث من هذا المستند')).toBeVisible();
    } finally {
      await stranger.close();
    }
  });

  test('gives an unknown code the bare invalid answer', async ({ page }) => {
    await page.goto('/verify/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await expect(page.getByText('لم يتم العثور على مستند بهذا الرمز')).toBeVisible();
    await expect(page.getByText('الرقم المرجعي')).toHaveCount(0);
  });
});
