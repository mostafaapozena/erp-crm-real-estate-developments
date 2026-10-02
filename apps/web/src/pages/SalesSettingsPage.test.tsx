import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, renderAt, stubApi } from '../testing/harness';
import SalesSettingsPage from './SalesSettingsPage';

/**
 * Settings → Sales (PLAT-024, CORE-DOC-001, SALE-RESERVE-006).
 *
 * Pinned here: a rule not configured says so and names its decision; only `settings.manage` may
 * change one, with a reason; the documents still on the legacy series are named; and activating a
 * format says whether it continues the series or starts a new one.
 */

const FIRST = { timeout: 4_000 } as const;

const setting = (key: string, value: unknown, decision?: string) => ({
  key,
  category: 'sales',
  value,
  defaultValue: null,
  configured: value !== null,
  ...(decision ? { decision } : {}),
  version: value === null ? 0 : 1,
});

const sequences = {
  items: [
    {
      type: 'reservation',
      version: 1,
      prefix: 'RSV',
      separator: '-',
      dateComponent: 'yyyy',
      entityComponent: false,
      branchComponent: false,
      projectComponent: false,
      padding: 5,
      resetPolicy: 'yearly',
      startAt: 1,
      effectiveFrom: '2026-01-01',
      state: 'draft',
      example: 'RSV-2026-00001',
      continuesLegacySeries: true,
      createdAt: '2026-10-01T08:00:00.000Z',
    },
  ],
};

const routes = {
  '/api/v1/settings': {
    items: [
      setting('sales.reservationValidityDays', null, 'BD-01'),
      setting('sales.quotationValidityDays', 30, 'BD-36'),
      { ...setting('display.dateFormat', 'dd/MM/yyyy'), category: 'display' },
    ],
  },
  '/api/v1/numbering/sequences': sequences,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sales settings', () => {
  it('shows what is not configured and offers no change without settings.manage', async () => {
    stubApi(['settings.view', 'numbering.view'], routes);
    renderAt(<SalesSettingsPage />, '/settings/sales', '/settings/sales');
    await screen.findByText('بانتظار BD-01', undefined, FIRST);
    expect(screen.getByText('30 يومًا')).toBeTruthy();
    expect(screen.queryByText('تنسيق التاريخ')).toBeNull();
    expect(screen.queryByRole('button', { name: 'تغيير' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تفعيل' })).toBeNull();
    expect(screen.getByText(/تُرقَّم المستندات التالية بالسلسلة الحالية/)).toBeTruthy();
  });

  it('changes a rule with a reason, and says an activated format continues the series', async () => {
    const requests = stubApi(
      ['settings.view', 'settings.manage', 'numbering.view', 'numbering.manage'],
      routes,
      {
        'PUT /api/v1/settings/sales.reservationValidityDays': () =>
          json(setting('sales.reservationValidityDays', 14, 'BD-01')),
      },
    );
    renderAt(<SalesSettingsPage />, '/settings/sales', '/settings/sales');
    const change = await screen.findAllByRole('button', { name: 'تغيير' }, FIRST);
    fireEvent.click(change[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'القيمة' }), {
      target: { value: '14' },
    });
    const save = within(dialog).getByRole('button', { name: 'حفظ' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByRole('textbox', { name: /السبب/ }), {
      target: { value: 'client decision recorded' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
        value: 14,
        expectedVersion: 0,
        reason: 'client decision recorded',
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'تفعيل' }));
    const activate = await screen.findByRole('dialog', { name: 'تفعيل صيغة الترقيم' });
    expect(within(activate).getByText(/تستكمل هذه الصيغة السلسلة الحالية/)).toBeTruthy();
  });
});
