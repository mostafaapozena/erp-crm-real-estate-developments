import type { ImportBatch } from '@alola/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createI18n } from '../i18n';
import { FIRST_RENDER, WARM_UP_BUDGET_MS, warmLazyModules } from '../testing/warm-up';

/**
 * The reference-data import screen (CORE-IMPORT-001, CORE-IMPORT-002).
 *
 * Pinned here: every issue is listed by row and column in the reader's language, and the commit
 * button stays disabled while any issue remains — the screen never offers a partial import.
 */

const session = {
  account: {
    accountId: 'acc_test',
    loginIdentifier: 'admin@demo.invalid',
    displayName: 'Test Admin',
    state: 'active',
    mfaEnabled: true,
    mfaRequired: true,
    credentialVersion: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  permissions: ['referenceData.manage'],
  scope: {
    level: 'all',
    teamIds: [],
    departmentIds: [],
    branchIds: [],
    projectIds: [],
    legalEntityIds: [],
  },
};

const batch = (overrides: Partial<Record<keyof ImportBatch, unknown>>): ImportBatch =>
  ({
    batchId: 'imp_000001',
    kind: 'referenceItems',
    format: 'csv',
    fileName: 'items.csv',
    state: 'previewed',
    totalRows: 2,
    validRows: 2,
    invalidRows: 0,
    issues: [],
    issueCount: 0,
    preview: [{ list: 'lossReasons', code: 'price', label_ar: 'السعر', label_en: 'Price' }],
    createdBy: 'acc_test',
    createdAt: '2026-10-01T09:00:00.000Z',
    expiresAt: '2026-10-02T09:00:00.000Z',
    version: 1,
    ...overrides,
  }) as ImportBatch;

let answer: ImportBatch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  window.history.pushState({}, '', '/imports');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const path = input.split('?')[0] ?? input;
      const routes: Record<string, unknown> = {
        '/api/v1/auth/refresh': { accessToken: 'access-token' },
        '/api/v1/me': session,
        '/api/v1/notifications/unread-count': { unread: 0 },
        '/api/v1/imports': answer,
      };
      const body = routes[path];
      return Promise.resolve(body === undefined ? json({ error: {} }, 404) : json(body, 201));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

async function uploadFile() {
  render(
    <StrictMode>
      <App i18n={createI18n(() => undefined)} />
    </StrictMode>,
  );
  await screen.findByRole('heading', { level: 1, name: 'استيراد البيانات المرجعية' }, FIRST_RENDER);
  const input = document.querySelector<HTMLInputElement>('#import-file');
  if (!input) throw new Error('no file input');
  fireEvent.change(input, {
    target: { files: [new File(['list,code'], 'items.csv', { type: 'text/csv' })] },
  });
}

// Compile and import the lazily loaded chunks once, before any test is timed.
beforeAll(warmLazyModules, WARM_UP_BUDGET_MS);

describe('import screen', () => {
  it('lists every issue in Arabic and will not offer a partial import', async () => {
    answer = batch({
      validRows: 1,
      invalidRows: 1,
      issueCount: 1,
      issues: [{ row: 3, column: 'code', code: 'CODE_TAKEN' }],
    });
    await uploadFile();
    const issues = await screen.findByRole('table', { name: 'المشكلات المكتشفة' });
    expect(within(issues).getByText('هذا الرمز موجود بالفعل')).toBeTruthy();
    const commit = screen.getByRole('button', { name: 'استيراد كل الصفوف' });
    expect(commit.hasAttribute('disabled')).toBe(true);
  });

  it('offers the commit for a clean file and shows its preview', async () => {
    answer = batch({});
    await uploadFile();
    const preview = await screen.findByRole('table', { name: 'معاينة' });
    expect(within(preview).getByText('السعر')).toBeTruthy();
    const commit = screen.getByRole('button', { name: 'استيراد كل الصفوف' });
    expect(commit.hasAttribute('disabled')).toBe(false);
  });
});
