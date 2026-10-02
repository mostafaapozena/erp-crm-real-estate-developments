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
  });

  it('asks the server for the state as it reads, kept in the address', async () => {
    const requests = stubApi(['sales.quotation.view'], {
      '/api/v1/sales/quotations': { items: [], total: 0, limit: 50 },
    });
    renderAt(<QuotationsPage />, '/quotations?state=expired&q=QUO-2026', '/quotations');
    await screen.findByRole('heading', { level: 1, name: 'عروض الأسعار' }, FIRST);
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === '/api/v1/sales/quotations' &&
            request.query.includes('state=expired') &&
            request.query.includes('search=QUO-2026'),
        ),
      ).toBe(true),
    );
    expect(screen.getByText('الحالة: منتهي الصلاحية')).toBeTruthy();
  });
});

describe('new quotation', () => {
  const stubNew = () =>
    stubApi(
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
  const openNew = () =>
    renderAt(
      <QuotationNewPage />,
      '/quotations/new?customerId=cus_000000000001&unitId=unit_000000000001',
      '/quotations/new',
    );

  it('says it reserves nothing and proposes no validity when none is configured', async () => {
    stubNew();
    openNew();
    await screen.findByText(
      'عرض السعر لا يحجز الوحدة: تبقى الوحدة متاحة للبيع، ولا يُنشأ عقد ولا أقساط.',
      undefined,
      FIRST,
    );
    await screen.findByText('لم تُحدَّد مدة صلاحية افتراضية (BD-36)؛ أدخل تاريخ انتهاء العرض.');
  });

  it('allows creation only after a server preview', async () => {
    const requests = stubNew();
    openNew();
    await screen.findByText('B-204', undefined, FIRST);
    // Text lookups, not role queries: a role query computes the accessible name of every control in
    // this large form, which is most of the test's cost on a busy machine.
    const create = screen.getByText('إنشاء عرض السعر').closest('button') as HTMLButtonElement;
    expect(create).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/صالح حتى/), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText(/تاريخ أول قسط/), {
      target: { value: '2026-11-01' },
    });
    fireEvent.click(screen.getByText('معاينة الجدول').closest('button') as HTMLButtonElement);
    await screen.findByText(/^قاعدة التقريب/u);
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
