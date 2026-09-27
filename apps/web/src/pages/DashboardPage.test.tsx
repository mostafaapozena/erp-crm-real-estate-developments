import type {
  ContractSummary,
  CrmDashboard,
  InstallmentPage,
  InventorySummary,
  MarketingOverview,
} from '@alola/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createI18n } from '../i18n';

/**
 * The signed-in dashboard, rendered exactly as `main.tsx` renders it — inside `StrictMode`.
 *
 * Two regressions are pinned here:
 *
 * 1. **One refresh request on start-up.** StrictMode runs the session-restoring effect twice. Before
 *    refresh became single-flight, both runs presented the same single-use refresh cookie and the
 *    second looked like a stolen token to the server, which revoked the session family (SEC-015).
 * 2. **Valid DOM nesting.** React reports block content inside a paragraph as a console error; the
 *    dashboard once rendered one, which a screen reader then announced as a broken paragraph.
 */

const session = {
  account: {
    accountId: 'acc_test',
    loginIdentifier: 'manager@demo.invalid',
    displayName: 'Test Manager',
    state: 'active',
    mfaEnabled: false,
    mfaRequired: false,
    credentialVersion: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  permissions: [
    'crm.lead.view',
    'inventory.unit.view',
    'sales.contract.view',
    'collection.installment.view',
    'marketing.campaign.view',
  ],
  scope: {
    level: 'all',
    teamIds: [],
    departmentIds: [],
    branchIds: [],
    projectIds: [],
    legalEntityIds: [],
  },
};

const crm: CrmDashboard = {
  totalLeads: 12,
  newLeads: 3,
  dueFollowUps: 1,
  overdueFollowUps: 0,
  wonLeads: 2,
  lostLeads: 1,
  conversionRate: '0.6667',
  byStage: { new: 3, contacted: 2 },
  bySource: { facebook: 4, referral: 2 },
  byOwner: [{ accountId: 'acc_test', total: 5, won: 2 }],
} as CrmDashboard;

const inventory: InventorySummary = {
  total: 46,
  byStatus: { available: 30, reserved: 2, contracted: 2 },
  byUsageType: { residential: 46 },
} as InventorySummary;

const summary: ContractSummary = {
  contracts: 2,
  byCurrency: [
    {
      currency: 'EGP',
      contracts: 2,
      totalContracted: { amount: '8450000.1', currency: 'EGP' },
      totalPaid: { amount: '1200000.2', currency: 'EGP' },
      totalOutstanding: { amount: '7249999.9', currency: 'EGP' },
    },
  ],
} as ContractSummary;

const installments: InstallmentPage = { items: [], total: 2, limit: 200 };

const marketing: MarketingOverview = {
  campaigns: 1,
  totalBudget: { amount: '1000', currency: 'EGP' },
  totalSpend: { amount: '500', currency: 'EGP' },
  totalLeads: 4,
  byPlatform: [
    { platform: 'facebook', campaigns: 1, spend: { amount: '500', currency: 'EGP' }, leads: 4 },
  ],
  providerConnected: false,
} as MarketingOverview;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let requests: string[];
/** How the dashboard data endpoints answer: with data, with a refusal, or never (still loading). */
let dataMode: 'ready' | 'forbidden' | 'pending';

beforeEach(() => {
  dataMode = 'ready';
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const path = input.split('?')[0] ?? input;
      requests.push(path);
      const routes: Record<string, unknown> = {
        '/api/v1/auth/refresh': { accessToken: 'access-token' },
        '/api/v1/me': session,
        '/api/v1/crm/dashboard': crm,
        '/api/v1/inventory/units/summary': inventory,
        '/api/v1/sales/contracts/summary': summary,
        '/api/v1/sales/installments': installments,
        '/api/v1/marketing/overview': marketing,
      };
      const body = routes[path];
      // Branding answers 404 here, so the application renders its neutral identity at once.
      const isData = !['/api/v1/auth/refresh', '/api/v1/me', '/api/v1/branding'].includes(path);
      if (isData && dataMode === 'pending') return new Promise<Response>(() => undefined);
      if (isData && dataMode === 'forbidden') return Promise.resolve(json({ error: {} }, 403));
      return Promise.resolve(body === undefined ? json({ error: {} }, 404) : json(body));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('signed-in dashboard under StrictMode', () => {
  it('restores the session with exactly one refresh request', async () => {
    render(
      <StrictMode>
        <App i18n={createI18n(() => undefined)} />
      </StrictMode>,
    );
    await screen.findByRole('heading', { level: 1, name: 'لوحة المتابعة' });
    expect(requests.filter((path) => path === '/api/v1/auth/refresh')).toHaveLength(1);
  });

  it('renders portfolio totals from the server summary, never a client-side float sum', async () => {
    render(
      <StrictMode>
        <App i18n={createI18n(() => undefined)} />
      </StrictMode>,
    );
    await screen.findByRole('heading', { level: 1, name: 'لوحة المتابعة' });
    // 8,450,000.10 exactly: the decimal string is formatted, never re-added in floating point.
    expect(await screen.findByText(/8,450,000\.10/)).toBeTruthy();
    expect(requests).toContain('/api/v1/sales/contracts/summary');
    expect(requests).not.toContain('/api/v1/sales/contracts');
  });

  it.each(['pending', 'forbidden'] as const)(
    'produces no invalid DOM nesting while data is %s',
    async (mode) => {
      dataMode = mode;
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
      });
      render(
        <StrictMode>
          <App i18n={createI18n(() => undefined)} />
        </StrictMode>,
      );
      await screen.findByRole('heading', { level: 1, name: 'لوحة المتابعة' });
      expect(
        errors.filter((line) => /descendant of|cannot be a child of|In HTML/.test(line)),
      ).toEqual([]);
      expect(document.querySelectorAll('p div, p p, p ul, p table')).toHaveLength(0);
    },
  );

  it('produces no invalid DOM nesting', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    render(
      <StrictMode>
        <App i18n={createI18n(() => undefined)} />
      </StrictMode>,
    );
    await screen.findByRole('heading', { level: 1, name: 'لوحة المتابعة' });
    await screen.findByText(/8,450,000\.10/);
    const nesting = errors.filter((line) =>
      /descendant of|cannot be a child of|validateDOMNesting|In HTML/.test(line),
    );
    expect(nesting).toEqual([]);
    // Nothing block-level may sit inside a paragraph anywhere on the page.
    expect(document.querySelectorAll('p div, p p, p ul, p table')).toHaveLength(0);
  });
});
