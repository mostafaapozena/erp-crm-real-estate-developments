import type { IssuedDocument } from '@alola/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../api/session';
import { BrandingProvider } from '../branding';
import { createI18n } from '../i18n';
import { LocaleProvider } from '../locale';
import { IssuedDocumentsPanel } from './IssuedDocumentsPanel';

/**
 * The issued-documents panel on a record page (CORE-DOC-003, CORE-DOC-005).
 *
 * Pinned here: the panel follows the permissions the API enforces — absent without document
 * permissions, no issue action without `document.generate`, no revoke without `document.revoke`; the
 * server's warnings are on screen before anything is issued; and issuing posts exactly the chosen
 * type, source and language.
 */

const FIRST = { timeout: 4_000 } as const;

const session = (permissions: string[]) => ({
  account: {
    accountId: 'acc_test',
    loginIdentifier: 'agent@demo.invalid',
    displayName: 'Test Agent',
    state: 'active',
    mfaEnabled: false,
    mfaRequired: false,
    credentialVersion: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  permissions,
  scope: {
    level: 'branch',
    teamIds: [],
    departmentIds: [],
    branchIds: ['br_1'],
    projectIds: [],
    legalEntityIds: [],
  },
});

const issued = {
  issueId: 'iss_000001',
  type: 'contractSummary',
  source: { type: 'contract', id: 'ctr_000001' },
  businessReference: 'CTR-2026-00002',
  locale: 'ar',
  version: 1,
  state: 'superseded',
  template: { key: 'builtin:contractSummary', version: 1 },
  companyVersion: 1,
  documentId: 'doc_000001',
  documentVersion: 1,
  fileSha256: 'a'.repeat(64),
  contentSha256: 'b'.repeat(64),
  fingerprint: 'BBBB-BBBB-BBBB-BBBB',
  pages: 2,
  restricted: [],
  issuedAt: '2026-09-28T10:00:00.000Z',
  issuedBy: 'acc_test',
  verificationUrl: 'http://localhost:5173/verify/abc',
} as unknown as IssuedDocument;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stub(permissions: string[]) {
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = input.split('?')[0] ?? input;
      if (init?.method === 'POST' && path === '/api/v1/issued-documents') {
        posts.push({ path, body: JSON.parse(init.body as string) });
        return Promise.resolve(json({ ...issued, issueId: 'iss_000002', version: 2 }));
      }
      const routes: Record<string, unknown> = {
        '/api/v1/auth/refresh': { accessToken: 'access-token' },
        '/api/v1/me': session(permissions),
        '/api/v1/issued-documents': { items: [issued] },
        '/api/v1/issued-documents/preview': {
          type: 'contractSummary',
          businessReference: 'CTR-2026-00002',
          nextVersion: { ar: 2, en: 1 },
          warnings: ['draft', 'notFinal', 'identityMissing'],
          restricted: [],
        },
      };
      const body = routes[path];
      return Promise.resolve(body === undefined ? json({ error: {} }, 404) : json(body));
    }),
  );
  return posts;
}

const renderPanel = () =>
  render(
    <StrictMode>
      <BrandingProvider>
        <LocaleProvider i18n={createI18n(() => undefined)}>
          <SessionProvider>
            <div data-testid="host">
              <IssuedDocumentsPanel
                sourceType="contract"
                sourceId="ctr_000001"
                types={['contractSummary', 'installmentSchedule']}
              />
            </div>
          </SessionProvider>
        </LocaleProvider>
      </BrandingProvider>
    </StrictMode>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('issued documents panel', () => {
  it('is absent without document permissions', async () => {
    stub(['sales.contract.view']);
    renderPanel();
    // The session resolves, and still nothing is rendered or requested.
    const calls = vi.mocked(fetch).mock.calls as unknown as [string][];
    await vi.waitFor(() => expect(calls.some(([path]) => path === '/api/v1/me')).toBe(true), FIRST);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByTestId('host').textContent).toBe('');
    expect(calls.some(([path]) => path.startsWith('/api/v1/issued-documents'))).toBe(false);
  });

  it('lists versions without issue or revoke actions for a reader', async () => {
    stub(['sales.contract.view', 'document.view', 'document.download']);
    renderPanel();
    await screen.findByText('CTR-2026-00002', {}, FIRST);
    expect(screen.getByText('حلّ محلها إصدار أحدث')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'إصدار مستند' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^إلغاء ملخص العقد/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'تنزيل ملخص العقد الإصدار 1' })).toBeTruthy();
    // The verification link stays on this origin.
    const verify = screen.getByRole('link', { name: 'فتح صفحة التحقق من ملخص العقد الإصدار 1' });
    expect(verify.getAttribute('href')).toBe('/verify/abc');
  });

  it('shows the warnings before issuing and posts the chosen language', async () => {
    const posts = stub([
      'sales.contract.view',
      'document.view',
      'document.generate',
      'document.revoke',
    ]);
    renderPanel();
    // A revoker sees the revoke action on a version that still stands or was superseded.
    await screen.findByRole('button', { name: 'إلغاء ملخص العقد الإصدار 1' }, FIRST);
    fireEvent.click(screen.getByRole('button', { name: 'إصدار مستند' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('بيانات هوية المشتري غير مسجّلة في العقد.');
    expect(within(dialog).getByText(/سيصدر الإصدار رقم 2/u)).toBeTruthy();

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'لغة المستند' }));
    fireEvent.click(await screen.findByRole('option', { name: 'الإنجليزية' }));
    await within(dialog).findByText(/سيصدر الإصدار رقم 1/u);
    fireEvent.click(within(dialog).getByRole('button', { name: 'إصدار' }));
    await screen.findByText('صدر ملخص العقد — الإصدار 2.');
    expect(posts).toEqual([
      {
        path: '/api/v1/issued-documents',
        body: { type: 'contractSummary', sourceId: 'ctr_000001', locale: 'en' },
      },
    ]);
  });
});
