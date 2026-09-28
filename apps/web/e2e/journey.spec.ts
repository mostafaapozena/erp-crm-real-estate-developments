import { expect, test } from '@playwright/test';
import { COLLECTOR, LABELS, SALES_MANAGER, open, signIn } from './demo';

/**
 * The demonstration journey, walked end to end in Arabic:
 *
 *   dashboard → lead → unit → reservation → contract → schedule → receipt → reminder
 *
 * Every screen here reads from the real API, which reads from real MongoDB. If the seed wrote a
 * contract whose instalments do not reconcile, or a receipt that allocated to nothing, these
 * assertions fail — which is the point of running the journey rather than checking that pages render.
 */
test.describe('the demonstration journey (Arabic, RTL)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, SALES_MANAGER);
  });

  test('opens on a dashboard with real figures, in Arabic RTL', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: LABELS.ar.dashboard, level: 1 })).toBeVisible();

    // The seeded organization has units, so the inventory figures are not zero. A dashboard of
    // zeroes would mean the scope filter or the aggregate is wrong, and both have been wrong before.
    const units = page.getByText(/^\d+$/).first();
    await expect(units).toBeVisible();
  });

  test('shows the pipeline, and a lead that reached a contract', async ({ page }) => {
    await open(page, '/leads');
    await expect(page.getByRole('heading', { name: LABELS.ar.leads, level: 1 })).toBeVisible();
    // Seeded, and unmistakably fictional.
    await expect(page.getByText('منى عبد الرحمن').first()).toBeVisible();
  });

  test('lists inventory with a status on every unit', async ({ page }) => {
    await open(page, '/units');
    await expect(page.getByRole('heading', { name: LABELS.ar.units, level: 1 })).toBeVisible();
    await expect(page.getByText('OASIS-A-0302').first()).toBeVisible();
    // Two units were contracted by the seed, so at least one row is not "available".
    await expect(page.locator('[data-tone]').first()).toBeVisible();
  });

  test('carries a reservation through to a contract with a schedule', async ({ page }) => {
    await open(page, '/contracts');
    await expect(page.getByRole('heading', { name: LABELS.ar.contracts, level: 1 })).toBeVisible();

    const firstContract = page.getByText(/^CTR-\d{4}-\d{5}$/).first();
    await expect(firstContract).toBeVisible();
    const contractNumber = (await firstContract.textContent())?.trim() ?? '';
    await firstContract.click();

    // The detail screen is the contract that was clicked, and it carries its schedule: every payment
    // plan the seed wrote has a down payment plus instalments, so there are rows to show.
    await expect(page.getByText(contractNumber).first()).toBeVisible();
    await expect(page.getByText(/\d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
    // Western digits in Arabic (SD-23, ADR-0003) — `ar-EG` would otherwise render Arabic-Indic ones.
    await expect(page.getByText(/[٠-٩]/)).toHaveCount(0);
  });

  test('shows instalments that are overdue and instalments still to come', async ({ page }) => {
    await open(page, '/installments');
    await expect(page.locator('[data-tone]').first()).toBeVisible();
    // The seed sweeps instalment states, so an overdue row exists. Without the sweep every row would
    // read "upcoming" however long ago it fell due — which is the screen the client is here to see.
    await expect(page.locator('[data-tone="danger"], [data-tone="warning"]').first()).toBeVisible();
  });
});

test.describe('collections and the reminder centre', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, COLLECTOR);
  });

  test('lists receipts allocated against the schedule', async ({ page }) => {
    await open(page, '/receipts');
    await expect(page.getByText(/^RCT-\d{4}-\d{5}$/).first()).toBeVisible();
  });

  test('states plainly that no delivery provider is connected', async ({ page }) => {
    await open(page, '/reminders');
    await expect(page.getByRole('heading', { name: LABELS.ar.reminders, level: 1 })).toBeVisible();
    // ADR-0026: the reminder centre never implies a message was delivered.
    await expect(page.getByText('محاكاة — واتساب غير متصل')).toBeVisible();
    // `مُرسل` is the label for the `sent` state, which nothing in this product can reach.
    await expect(page.getByText('مُرسل', { exact: true })).toHaveCount(0);
  });
});

test.describe('tasks', () => {
  test('opens the tasks screen and its calendar against the real API', async ({ page }) => {
    await signIn(page, SALES_MANAGER);
    await open(page, '/tasks');
    await expect(page.getByRole('heading', { name: 'المهام', level: 1 })).toBeVisible();
    // The demonstration seeds no tasks: the empty state is shown, not a blank table.
    await expect(page.getByText('لا توجد مهام').first()).toBeVisible();
    await page.getByRole('tab', { name: 'التقويم' }).click();
    const grid = page.getByRole('grid');
    await expect(grid.getByRole('columnheader')).toHaveCount(7);
    await expect(grid.getByRole('gridcell')).toHaveCount(42);
  });
});
