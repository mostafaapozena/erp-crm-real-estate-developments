import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, renderAt, stubApi } from '../testing/harness';
import ContractDetailPage from './ContractDetailPage';

/**
 * The contract workspace (SALE-CONTRACT-001 … 003, BMP-1 package 8).
 *
 * Pinned here: a draft says it commits nothing; activation is offered only with its permission and
 * only after the server's review is on screen and the person confirms it; the request carries the
 * version reviewed and an idempotency key; what blocks activation is named and disables it; and a
 * refusal to cancel after collection says why.
 */

const FIRST = { timeout: 4_000 } as const;
const money = (amount: string) => ({ amount, currency: 'EGP' });

const draft = {
  contractId: 'ctr_000000000001',
  contractNumber: 'CTR-2026-00009',
  customerId: 'cus_000000000001',
  unitId: 'unit_000000000001',
  projectId: 'prj_000000000001',
  reservationId: 'rsv_000000000001',
  contractedOn: '2026-10-01',
  totalPrice: money('3000000'),
  reservationAmount: money('100000'),
  paymentPlan: {
    downPayment: money('600000'),
    installmentCount: 2,
    frequency: 'monthly',
    firstDueOn: '2026-11-01',
  },
  outstandingAmount: money('3000000'),
  paidAmount: money('0'),
  customerSnapshot: {
    customerId: 'cus_000000000001',
    kind: 'individual',
    name: 'منى عبد الرحمن',
    primaryPhone: '+201000000001',
  },
  unitSnapshot: { unitId: 'unit_000000000001', code: 'A-101', projectId: 'prj_000000000001' },
  pricing: {
    agreedPrice: money('3000000'),
    discountPercentage: '0',
    reservationAmount: money('100000'),
  },
  parties: [
    { role: 'buyer', customerId: 'cus_000000000001', sharePercent: '100', name: 'منى عبد الرحمن' },
  ],
  signing: { state: 'unsigned' },
  exceptions: [],
  warnings: ['identityMissing', 'notSigned'],
  approvals: [],
  amendments: [],
  refundHandoff: 'notApplicable',
  draftSchedule: [
    { sequence: 1, kind: 'downPayment', dueOn: '2026-11-01', amount: money('600000') },
    { sequence: 2, kind: 'installment', dueOn: '2026-11-01', amount: money('1200000') },
    { sequence: 3, kind: 'installment', dueOn: '2026-12-01', amount: money('1200000') },
  ],
  salesOwnerAccountId: 'acc_test',
  legalEntityId: 'le_000000000001',
  branchId: 'br_000000000001',
  state: 'draft',
  version: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

const review = (blockers: string[] = [], approvalRequired = false) => ({
  contractId: draft.contractId,
  state: 'draft',
  version: 3,
  exceptions: [],
  approvalRequired,
  blockers,
  warnings: ['identityMissing', 'notSigned'],
  rows: draft.draftSchedule,
  total: money('3000000'),
  reservationCredit: money('100000'),
});

const routes = (overrides: Record<string, unknown> = {}) => ({
  [`/api/v1/sales/contracts/${draft.contractId}`]: draft,
  [`/api/v1/sales/contracts/${draft.contractId}/history`]: { items: [] },
  [`/api/v1/sales/contracts/${draft.contractId}/activation-review`]: review(),
  '/api/v1/inventory/projects': { items: [] },
  ...overrides,
});

const open = () =>
  renderAt(<ContractDetailPage />, `/contracts/${draft.contractId}`, '/contracts/:contractId');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('contract workspace', () => {
  it('says a draft commits nothing and shows the proposed schedule', async () => {
    stubApi(['sales.contract.view'], routes());
    open();
    await screen.findByRole('heading', { level: 1, name: 'CTR-2026-00009' }, FIRST);
    expect(screen.getByText('هذا العقد مسودة')).toBeTruthy();
    expect(screen.getAllByText('الجدول المقترح').length).toBeGreaterThan(0);
    expect(
      screen.getByText('هذه البنود هي ما سيُجمَّد عند التفعيل، ولا يُستحق شيء منها قبل ذلك.'),
    ).toBeTruthy();
    // Without the activation permission there is no activation, plan or party editing.
    expect(screen.queryByRole('button', { name: 'تفعيل العقد' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تعديل خطة السداد' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تعديل الأطراف' })).toBeNull();
  });

  it('activates only after the review is confirmed, sending the reviewed version and a key', async () => {
    const requests = stubApi(
      ['sales.contract.view', 'sales.contract.activate', 'sales.contract.create'],
      routes(),
      {
        [`POST /api/v1/sales/contracts/${draft.contractId}/activate`]: () =>
          json({ ...draft, state: 'active', version: 4 }),
      },
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'تفعيل العقد' }, FIRST));
    const dialog = await screen.findByRole('dialog', { name: 'مراجعة تفعيل العقد' });
    await within(dialog).findByText('لا يتطلب هذا التفعيل موافقة؛ يكفي إذنك.');
    const confirm = within(dialog).getByRole('button', { name: 'تفعيل العقد' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);
    await screen.findByText('فُعِّل العقد وأُنشئ جدول الأقساط.');
    const posted = requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/activate'),
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({ expectedVersion: 3 });
    expect(String((posted[0]?.body as { idempotencyKey?: string }).idempotencyKey)).toMatch(
      /^activate-/,
    );
  });

  it('names what blocks activation and keeps it disabled', async () => {
    stubApi(
      ['sales.contract.view', 'sales.contract.activate'],
      routes({
        [`/api/v1/sales/contracts/${draft.contractId}/activation-review`]: review([
          'reservationNotConfirmed',
        ]),
      }),
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'تفعيل العقد' }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('الحجز المرتبط غير مؤكد.');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(within(dialog).getByRole('button', { name: 'تفعيل العقد' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('offers submission for approval when the review says one is required', async () => {
    stubApi(
      ['sales.contract.view', 'sales.contract.activate'],
      routes({
        [`/api/v1/sales/contracts/${draft.contractId}/activation-review`]: review([], true),
      }),
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'تفعيل العقد' }, FIRST));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: 'إرسال للموافقة' });
  });

  it('explains a refused cancellation after collection', async () => {
    const active = { ...draft, state: 'active', version: 4, draftSchedule: undefined };
    stubApi(
      ['sales.contract.view', 'sales.contract.cancel'],
      routes({
        [`/api/v1/sales/contracts/${draft.contractId}`]: active,
        [`/api/v1/sales/contracts/${draft.contractId}/installments`]: { items: [] },
        [`/api/v1/sales/customers/${draft.customerId}/summary`]: {
          customerId: draft.customerId,
          contracts: 1,
          totalContracted: money('3000000'),
          totalPaid: money('350000'),
          totalOutstanding: money('2650000'),
          overdueCount: 0,
          overdueAmount: money('0'),
        },
      }),
      {
        [`POST /api/v1/sales/contracts/${draft.contractId}/cancel`]: () =>
          json(
            {
              error: {
                code: 'CONFLICT',
                correlationId: 'c',
                issues: [{ path: ['state'], code: 'CONTRACT_HAS_COLLECTIONS' }],
              },
            },
            409,
          ),
      },
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء العقد' }, FIRST));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /السبب/ }), {
      target: { value: 'customer withdrew' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toContain(
        'حُصّل عليه مبلغ يزيد على مبلغ الحجز',
      ),
    );
  });
});
