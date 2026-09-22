import { expect, test, type Page } from '@playwright/test';
import { LABELS, mainNav, open, SALES_REP, signIn } from './demo';

/**
 * Authorization, tested where it actually matters.
 *
 * A hidden menu entry is a courtesy, not a control (ADR-0006). Each test here checks **both**: that
 * the interface does not offer what the account cannot do, and that the server refuses it when the
 * request is made anyway. A suite that only checked the menu would pass against a system with no
 * authorization at all.
 *
 * The direct requests carry the account's **real** access token, captured from a request the
 * application itself made, and are then sent from outside the browser. That is the shape worth
 * testing: someone legitimately signed in, asking for something they may not have. Sending no
 * credentials would only prove that anonymous requests are refused, which is a far weaker claim.
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

test.describe('what a sales representative cannot reach', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, SALES_REP);
  });

  test('is not offered the marketing centre', async ({ page }) => {
    const navigation = await mainNav(page);
    await expect(navigation.getByRole('link', { name: LABELS.ar.campaigns })).toHaveCount(0);
    // The menu is not empty — the account simply has a smaller one.
    await expect(navigation.getByRole('link', { name: LABELS.ar.units })).toBeVisible();
  });

  test('is refused the marketing API when the request is made outside the application', async ({
    page,
    request,
  }) => {
    const authorization = await bearerToken(page);

    const forbidden = await request.get('http://localhost:4000/api/v1/marketing/campaigns', {
      headers: { authorization },
    });
    expect(forbidden.status()).toBe(403);
    // The refusal never names the permission that would have worked (SEC-031).
    expect(await forbidden.text()).not.toContain('marketing.campaign');

    // The same token still works for what the account may do, so the 403 is authorization rather
    // than a broken session.
    const allowed = await request.get('http://localhost:4000/api/v1/inventory/units?limit=1', {
      headers: { authorization },
    });
    expect(allowed.status()).toBe(200);

    // And with no credentials the answer is 401, not 403: the two remain distinguishable.
    const anonymous = await request.get('http://localhost:4000/api/v1/marketing/campaigns');
    expect(anonymous.status()).toBe(401);
  });

  test('sees the forbidden state, not a blank screen, when it opens the page anyway', async ({
    page,
  }) => {
    await open(page, '/campaigns');
    // THEME-010: forbidden is one of the five states every screen handles, and it says so in Arabic.
    await expect(page.getByText('غير مصرّح')).toBeVisible();
  });

  test('cannot see the Alexandria project, because its data scope stops at New Cairo', async ({
    page,
    request,
  }) => {
    await open(page, '/units');
    await expect(page.getByText('OASIS-A-0302').first()).toBeVisible();
    await expect(page.getByText(/CORNICHE-T1/)).toHaveCount(0);

    // The scope is applied inside the query (SEC-027), so the Alexandria units are not filtered out
    // of the table — they never leave the database. Asking the API directly gets the same answer.
    // 100 is the largest page the contract allows, and it covers every unit this account can see.
    const authorization = await bearerToken(page);
    const response = await request.get('http://localhost:4000/api/v1/inventory/units?limit=100', {
      headers: { authorization },
    });
    expect(response.status()).toBe(200);
    const listed = (await response.json()) as { items: { code: string }[] };
    expect(listed.items.length).toBeGreaterThan(0);
    expect(listed.items.some((unit) => unit.code.startsWith('CORNICHE'))).toBe(false);
  });
});
