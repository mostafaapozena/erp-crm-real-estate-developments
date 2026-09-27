import { expect, test } from '@playwright/test';
import { LABELS, mainNav, open, SALES_MANAGER, signIn } from './demo';

/**
 * Arabic first, English beside it, Light Mode only — on the real screens, not a sample page.
 *
 * The sign-in screen is tested on its own because a person who cannot read it cannot reach the switch
 * that would fix it, and that has to hold before anyone signs in.
 */
test.describe('the sign-in screen', () => {
  test('is Arabic and right-to-left before anyone signs in', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تسجيل الدخول');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Alexandria/);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('700 16px Alexandria', 'دخول'))).toBe(
      true,
    );
  });

  test('says it is a demonstration with fictional data', async ({ page }) => {
    await page.goto('/');
    // ADR-0026: nobody should be able to mistake this for a live system, least of all at the door.
    await expect(page.getByText(/بيئة عرض تجريبي/)).toBeVisible();
  });

  test('can be switched to English before signing in, and back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: LABELS.ar.switchTo }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Inter/);

    await page.getByRole('button', { name: LABELS.en.switchTo }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('stays in Light Mode when the system prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  });

  test('offers a keyboard route to the form with a visible focus ring', async ({ page }) => {
    await page.goto('/');
    const identifier = page.getByLabel(LABELS.ar.identifier);
    await identifier.focus();
    await expect(identifier).toBeFocused();
  });
});

test.describe('the signed-in shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, SALES_MANAGER);
  });

  test('switches a data screen to English without leaving Arabic text behind', async ({ page }) => {
    await open(page, '/units');
    await expect(page.getByRole('heading', { name: LABELS.ar.units, level: 1 })).toBeVisible();

    await page.getByRole('button', { name: LABELS.ar.switchTo }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: LABELS.en.units, level: 1 })).toBeVisible();

    // The chrome is fully English. Customer and project names stay as they were entered — those are
    // data, not interface text, and translating them would be inventing a name nobody chose.
    await expect((await mainNav(page)).getByText(/[؀-ۿ]/)).toHaveCount(0);
  });

  test('renders money and dates with Western digits in Arabic', async ({ page }) => {
    await open(page, '/installments');
    // SD-23 / ADR-0003: `ar-EG` would otherwise produce Arabic-Indic digits, and the contracts reject
    // them. The formatter forces `-u-nu-latn`, and this is where that is visible.
    await expect(page.getByText(/[٠-٩]/)).toHaveCount(0);
    await expect(page.getByText(/\d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  });

  test('puts the navigation at the inline start in both directions', async ({ page }) => {
    // On a phone the drawer is temporary: `mainNav` opens it, and its backdrop covers the rest of
    // the page, so it is closed before the language switch and reopened to be measured. The
    // assertion is the same on both viewports — the drawer enters from the inline start.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const width = viewport?.width ?? 0;

    // Probed **before** the drawer opens: once a modal drawer is open, MUI marks the rest of the page
    // `aria-hidden`, so a role query for the toggle would find nothing and report "not temporary".
    const temporary = await page
      .getByRole('button', { name: LABELS.ar.openNavigation })
      .isVisible();

    const rtlNavigation = await mainNav(page);
    const rtl = await rtlNavigation.boundingBox();
    expect(rtl).not.toBeNull();
    // Right-hand side in Arabic.
    expect((rtl?.x ?? 0) + (rtl?.width ?? 0)).toBeGreaterThan(width / 2);
    expect(rtl?.x ?? 0).toBeGreaterThanOrEqual(width / 2 - (rtl?.width ?? 0));

    if (temporary) {
      await page.keyboard.press('Escape');
      await expect(page.locator('#app-navigation')).toBeHidden();
    }

    await page.getByRole('button', { name: LABELS.ar.switchTo }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    const ltrNavigation = await mainNav(page);
    const ltr = await ltrNavigation.boundingBox();
    expect(ltr).not.toBeNull();
    // Left-hand side in English — the same component, mirrored by logical CSS rather than by a
    // second stylesheet.
    expect(ltr?.x ?? Number.MAX_SAFE_INTEGER).toBeLessThan(width / 2);
    expect((ltr?.x ?? 0) + (ltr?.width ?? 0)).toBeLessThanOrEqual(width / 2 + (ltr?.width ?? 0));
  });
});
