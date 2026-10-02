import { expect, test, type Page } from '@playwright/test';
import { LABELS, SALES_MANAGER, SALES_REP, mainNav, open, signIn } from './demo';

/**
 * The BMP-1 commercial screens (package 8), against the built web application, the built API and the
 * real database: quotations, the customer workspace, the contract workspace, the unit timeline and the
 * sales settings — in Arabic and English, desktop and phone.
 *
 * **Read-only on business data**, like the rest of the suite: nothing is quoted, reserved, drafted or
 * activated here. Forms are opened and closed; the server's refusal of an activation the account may not
 * make is proven with the account's own token, from outside the application. Requires the demonstration
 * data and `npm run seed:demo:bmp1`.
 */

async function bearerToken(page: Page): Promise<string> {
  const [request] = await Promise.all([
    page.waitForRequest(
      (candidate) =>
        candidate.url().includes('/api/v1/') && Boolean(candidate.headers()['authorization']),
    ),
    page.reload(),
  ]);
  const header = request.headers()['authorization'];
  if (!header) throw new Error('the application made no authenticated request to capture');
  return header;
}

test.describe('quotations', () => {
  test('are in the navigation, list in scope, and a new one says it reserves nothing', async ({
    page,
  }) => {
    await signIn(page, SALES_MANAGER);
    const navigation = await mainNav(page);
    await navigation.getByRole('link', { name: 'عروض الأسعار' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'عروض الأسعار' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('link', { name: 'عرض سعر جديد' }).click();
    await expect(
      page.getByText('عرض السعر لا يحجز الوحدة: تبقى الوحدة متاحة للبيع، ولا يُنشأ عقد ولا أقساط.'),
    ).toBeVisible();
    // Nothing can be created before the server has previewed the schedule.
    await expect(page.getByRole('button', { name: 'إنشاء عرض السعر' })).toBeDisabled();
    await page.getByRole('button', { name: 'إلغاء' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'عروض الأسعار' })).toBeVisible();
  });
});

test.describe('the customer workspace', () => {
  test('opens from the customer list and shows the sections the manager may see', async ({
    page,
  }) => {
    await signIn(page, SALES_MANAGER);
    await open(page, '/customers');
    await page.getByRole('row').nth(1).or(page.locator('li[role="button"]').first()).click();
    await expect(page.getByText('ملف العميل').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'بيانات العميل' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'العقود', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'الفرص البيعية' })).toBeVisible();
    // No raw record identifier is shown as a reference.
    await expect(page.getByText(/\b(cus|ctr|rsv)_[a-f0-9]{8,}/u)).toHaveCount(0);
  });

  test('tells a representative the identity is restricted, and switches to English', async ({
    page,
  }) => {
    await signIn(page, SALES_REP);
    await open(page, '/customers');
    await page.getByRole('row').nth(1).or(page.locator('li[role="button"]').first()).click();
    await expect(page.getByText('بيانات الهوية مقيّدة ولا تملك صلاحية الاطلاع عليها.')).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await page.getByRole('button', { name: LABELS.ar.switchTo }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(
      page.getByText('Identity details are restricted and you may not see them.'),
    ).toBeVisible();
  });
});

test.describe('the contract workspace', () => {
  test('shows an active contract frozen, with its history and no draft controls', async ({
    page,
  }) => {
    await signIn(page, SALES_MANAGER);
    await open(page, '/contracts');
    await page.getByText('CTR-2026-00001').first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'CTR-2026-00001' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'سجل العقد' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تفعيل العقد' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'تعديل خطة السداد' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'تعديل الأطراف' })).toHaveCount(0);
  });

  test('refuses an activation to a representative, from outside the application', async ({
    page,
    request,
  }) => {
    await signIn(page, SALES_REP);
    const authorization = await bearerToken(page);
    const list = await request.get('http://localhost:4000/api/v1/sales/contracts?limit=1', {
      headers: { authorization },
    });
    expect(list.status()).toBe(200);
    const contractId = ((await list.json()) as { items: { contractId: string }[] }).items[0]
      ?.contractId;
    expect(contractId, 'a contract in the representative scope').toBeTruthy();
    const refused = await request.post(
      `http://localhost:4000/api/v1/sales/contracts/${contractId}/activate`,
      {
        headers: { authorization, origin: 'http://localhost:4173' },
        data: { expectedVersion: 1 },
      },
    );
    expect(refused.status()).toBe(403);
    expect(await refused.text()).not.toContain('sales.contract.activate');
  });
});

test.describe('the unit timeline', () => {
  test('names the creation of a unit as such, not as a status', async ({ page }) => {
    await signIn(page, SALES_MANAGER);
    await open(page, '/units');
    await page.getByRole('row').nth(1).or(page.locator('li[role="button"]').first()).click();
    await expect(page.getByText('إنشاء الوحدة').first()).toBeVisible({ timeout: 20_000 });
  });
});
