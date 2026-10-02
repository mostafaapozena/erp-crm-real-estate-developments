import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../testing/harness';
import CustomerDetailPage from './CustomerDetailPage';

/**
 * The customer workspace (CRM-PERSON-004, BMP-1 package 8).
 *
 * Pinned here: the identity appears only when the API returned it, and otherwise the page says why
 * without asking any other endpoint for it; a section the viewer holds no permission for is never
 * requested; and the sections a viewer may see are each read through their own scoped request.
 */

const FIRST = { timeout: 4_000 } as const;

const customer = (identity?: { type: string; number: string }) => ({
  customerId: 'cus_000000000001',
  kind: 'individual',
  name: 'منى عبد الرحمن',
  primaryPhone: '+201000000001',
  consents: [],
  legalEntityId: 'le_000000000001',
  branchId: 'br_000000000001',
  ownerAccountId: 'acc_test',
  version: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  ...(identity ? { identity } : {}),
});

const base = (record: unknown) => ({
  '/api/v1/crm/customers/cus_000000000001': record,
  '/api/v1/crm/customers/cus_000000000001/activities': { items: [] },
  '/api/v1/crm/customers/cus_000000000001/ownership': { items: [] },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('customer workspace', () => {
  it('says the identity is restricted and requests no section it may not see', async () => {
    const requests = stubApi(['crm.customer.view'], base(customer()));
    renderAt(<CustomerDetailPage />, '/customers/cus_000000000001', '/customers/:customerId');
    await screen.findByRole('heading', { level: 1, name: 'منى عبد الرحمن' }, FIRST);
    expect(screen.getByText('بيانات الهوية مقيّدة ولا تملك صلاحية الاطلاع عليها.')).toBeTruthy();
    const asked = requests.map((request) => request.path);
    for (const forbidden of [
      '/api/v1/sales/contracts',
      '/api/v1/sales/reservations',
      '/api/v1/sales/quotations',
      '/api/v1/collections/receipts',
      '/api/v1/sales/customers/cus_000000000001/summary',
      '/api/v1/crm/opportunities',
    ]) {
      expect(asked).not.toContain(forbidden);
    }
    expect(screen.queryByRole('link', { name: 'حجز جديد' })).toBeNull();
  });

  it('shows the identity the API returned, and each permitted section from its own request', async () => {
    const requests = stubApi(
      [
        'crm.customer.view',
        'crm.customer.viewIdentity',
        'sales.contract.view',
        'sales.quotation.view',
      ],
      {
        ...base(customer({ type: 'nationalId', number: '29001011234567' })),
        '/api/v1/sales/contracts': { items: [], total: 0, limit: 10 },
        '/api/v1/sales/quotations': { items: [], total: 0, limit: 10 },
        '/api/v1/sales/customers/cus_000000000001/summary': {
          customerId: 'cus_000000000001',
          contracts: 0,
          totalContracted: { amount: '0', currency: 'EGP' },
          totalPaid: { amount: '0', currency: 'EGP' },
          totalOutstanding: { amount: '0', currency: 'EGP' },
          overdueCount: 0,
          overdueAmount: { amount: '0', currency: 'EGP' },
        },
      },
    );
    renderAt(<CustomerDetailPage />, '/customers/cus_000000000001', '/customers/:customerId');
    await screen.findByText('29001011234567', undefined, FIRST);
    await screen.findByText('لا توجد عقود');
    await screen.findByText('لا توجد عروض أسعار');
    const contracts = requests.find((request) => request.path === '/api/v1/sales/contracts');
    expect(contracts?.query).toContain('customerId=cus_000000000001');
    expect(requests.map((request) => request.path)).not.toContain('/api/v1/sales/reservations');
  });
});
