import { expect, test, type Page } from '@playwright/test';

async function switchToEnglish(page: Page) {
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
}

test.describe('Arabic RTL / English LTR smoke (TEST-003)', () => {
  test('starts in Arabic RTL with Alexandria', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('نظام العلا');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('أساس المنصة');
    await expect(heading).toHaveCSS('font-family', /Alexandria/);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('700 16px Alexandria', 'أساس'))).toBe(
      true,
    );
  });

  test('switches to English LTR with Inter, then back', async ({ page }) => {
    await page.goto('/');
    await switchToEnglish(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('ALOLA ERP');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('Platform foundation');
    await expect(heading).toHaveCSS('font-family', /Inter/);
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('keeps LTR values isolated inside RTL text', async ({ page }) => {
    await page.goto('/');
    const phone = page.getByText('+201001234567');
    await expect(phone).toHaveAttribute('dir', 'ltr');
    await expect(phone).toHaveText('+201001234567');
  });

  test('stays in Light Mode when the system prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('color', 'rgb(15, 23, 42)');
  });

  test('shows a visible focus ring when operated by keyboard', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'English' });
    for (
      let i = 0;
      i < 10 && !(await button.evaluate((el) => el === document.activeElement));
      i += 1
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS('outline-style', 'solid');
    await expect(button).toHaveCSS('outline-width', '3px');
    await expect(button).toHaveCSS('outline-color', 'rgb(29, 78, 216)');
  });

  test('offers a skip link as the first keyboard stop', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'الانتقال إلى المحتوى' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
  });
});

test.describe('responsive navigation (THEME-012)', () => {
  test('places navigation at the inline start in both directions', async ({ page, isMobile }) => {
    await page.goto('/');
    if (isMobile) {
      await page.getByRole('button', { name: 'فتح قائمة التنقل' }).click();
    }
    const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' });
    await expect(nav).toBeVisible();
    const viewport = page.viewportSize();
    const rtlBox = await nav.boundingBox();
    expect(rtlBox && viewport && rtlBox.x + rtlBox.width / 2).toBeGreaterThan(
      (viewport?.width ?? 0) / 2,
    );

    if (isMobile) await page.keyboard.press('Escape');
    await switchToEnglish(page);
    if (isMobile) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    const ltrNav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(ltrNav).toBeVisible();
    const ltrBox = await ltrNav.boundingBox();
    expect(ltrBox && viewport && ltrBox.x + ltrBox.width / 2).toBeLessThan(
      (viewport?.width ?? 0) / 2,
    );
  });
});
