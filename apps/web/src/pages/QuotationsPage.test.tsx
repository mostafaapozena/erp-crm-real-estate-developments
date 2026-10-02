import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, renderAt, stubApi } from '../testing/harness';
import QuotationDetailPage from './QuotationDetailPage';
import QuotationNewPage from './QuotationNewPage';
import QuotationsPage from './QuotationsPage';

/**
 * Quotation screens (SALE-QUOTE-001, BMP-1 package 8).
 *
 * Pinned here: the list names customers through one scoped lookup and filters by the state as the
 * server computes it; the form says a quotation reserves nothing, previews the schedule on the server
 * before it may be created, and proposes the validity only when one is configured; the detail page
 * keeps revisions and offers revise/withdraw only to someone who may manage quotations.
 */

const FIRST = { timeout: 4_000 } as const;
const money = (amount: string) => ({ amount, currency: 'EGP' });

const quotation = (overrides: Record<string, unknown> = {}) => ({
  quotationId: 'quo_000000000001',
  quotationNumber: 'QUO-2026-00004',
  revision: 2,
  customerId: 'cus_000000000001',
  unitId: 'unit_000000000001',
  unitCode: 'B-204',
  projectId: 'prj_000000000001',
  listPrice: money('3000000'),
  agreedPrice: money('2850000'),
  discountPercentage: '5',
  paymentPlan: {
    downPayment: money('600000'),
    installmentCount: 1,
    frequency: 'monthly',
    firstDueOn: '2026-11-01',
  },
  rows: [
    { sequence: 1, kind: 'downPayment', dueOn: '2026-11-01', amount: money('600000') },
    { sequence: 2, kind: 'installment', dueOn: '2026-11-01', amount: money('2250000') },
  ],
  total: money('2850000'),
  validUntil: '2026-10-20',
  state: 'active',
  salesOwnerAccountId: 'acc_test',
  legalEntityId: 'le_000000000001',
  branchId: 'br_000000000001',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('quotation list', () => {
  it('names customers in one scoped request and filters by the computed state', async () => {
    const requests = stubApi(['sales.quotation.view', 'crm.customer.view'], {
      '/api/v1/sales/quotations': { items: [quotation()], total: 1, limit: 50 },
      '/api/v1/crm/customers': {
        items: [{ customerId: 'cus_000000000001', name: 'منى عبد الرحمن' }],
        total: 1,
        limit: 100,
      },
    });
    renderAt(<QuotationsPage />, '/quotations', '/quotations');
    await screen.findByRole('heading', { level: 1, name: 'عروض الأسعار' }, FIRST);
    await screen.findByText('منى عبد الرحمن');
    const lookups = requests.filter((request) => request.path === '/api/v1/crm/customers');
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.query).toContain('ids=cus_000000000001');
    // Without manage permission there is no "new quotation".
    expect(screen.queryByRole('link', { name: 'عرض سعر جديد' })).toBeNull();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'الحالة' }));
    fireEvent.click(await screen.findByRole('option', { name: 'منتهي الصلاحية' }));
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === '/api/v1/sales/quotations' && request.query.includes('state=expired'),
        ),
      ).toBe(true),
    );
  });
});

describe('new quotation', () => {
  it('says it reserves nothing and allows creation only after a server preview', async () => {
    const requests = stubApi(
      ['sales.quotation.manage', 'crm.customer.view', 'inventory.unit.view'],
      {
        '/api/v1/sales/defaults': {
          reservationValidityDays: 14,
          quotationValidityDays: null,
          decisions: { reservationValidityDays: 'BD-01', quotationValidityDays: 'BD-36' },
        },
        '/api/v1/crm/customers/cus_000000000001': {
          customerId: 'cus_000000000001',
          name: 'منى عبد الرحمن',
        },
        '/api/v1/inventory/units/unit_000000000001': {
          unitId: 'unit_000000000001',
          code: 'B-204',
          area: '120',
          currentPrice: money('3000000'),
        },
      },
      {
        'POST /api/v1/sales/schedule/preview': () =>
          json({
            rows: quotation().rows,
            total: money('3000000'),
            price: money('3000000'),
            roundingRule: 'oddPiastresToEarliestRows',
            rowsTotal: money('3000000'),
          }),
      },
    );
    renderAt(
      <QuotationNewPage />,
      '/quotations/new?customerId=cus_000000000001&unitId=unit_000000000001',
      '/quotations/new',
    );
    await screen.findByText(
      'عرض السعر لا يحجز الوحدة: تبقى الوحدة متاحة للبيع، ولا يُنشأ عقد ولا أقساط.',
      undefined,
      FIRST,
    );
    // No validity is configured, so none is proposed.
    await screen.findByText('لم تُحدَّد مدة صلاحية افتراضية (BD-36)؛ أدخل تاريخ انتهاء العرض.');
    const create = screen.getByRole('button', { name: 'إنشاء عرض السعر' });
    expect(create).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/صالح حتى/), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText(/تاريخ أول قسط/), {
      target: { value: '2026-11-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'معاينة الجدول' }));
    await screen.findByText('قاعدة التقريب', { exact: false });
    await waitFor(() => expect(create).toHaveProperty('disabled', false));
    expect(requests.some((request) => request.path === '/api/v1/sales/schedule/preview')).toBe(
      true,
    );
    expect(
      requests.some(
        (request) => request.method === 'POST' && request.path === '/api/v1/sales/quotations',
      ),
    ).toBe(false);
  });
});

describe('quotation detail', () => {
  it('shows revisions and offers revise and withdraw only to a manager', async () => {
    stubApi(['sales.quotation.view'], {
      '/api/v1/sales/quotations/quo_000000000001': {
        items: [quotation(), quotation({ revision: 1, state: 'superseded' })],
      },
    });
    renderAt(<QuotationDetailPage />, '/quotations/quo_000000000001', '/quotations/:quotationId');
    await screen.findByRole('heading', { level: 1, name: 'QUO-2026-00004' }, FIRST);
    const history = screen.getByRole('region', { name: 'سجل الإصدارات' });
    expect(within(history).getByText('استُبدل بنسخة أحدث')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'إصدار جديد' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'سحب العرض' })).toBeNull();
  });
});
