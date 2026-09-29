import type { PublicVerification } from '@alola/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createI18n } from '../i18n';
import { FIRST_RENDER, WARM_UP_BUDGET_MS, warmLazyModules } from '../testing/warm-up';

/**
 * The public verification page (CORE-DOC-005).
 *
 * Pinned here: it renders without a session and never asks for one; it shows the server's public
 * answer and nothing more; an unknown code shows no document fields; and a throttled answer says so.
 */

const TOKEN = 'Q2hlY2tpbmctdGhlLXB1YmxpYy12ZXJpZmljYXRpb24';

const valid = {
  result: 'superseded',
  company: { ar: 'شركة تجريبية', en: 'Example Developments' },
  documentType: 'receipt',
  businessReference: 'RCP-2026-00007',
  issuedOn: '2026-09-28',
  version: 2,
  fingerprint: '1820-BA36-5537-8316',
  checkedAt: '2026-09-29T08:00:00.000Z',
} as unknown as PublicVerification;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(answer: () => Response) {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      calls.push({ path: input, init });
      if (input.startsWith('/api/v1/public/verify/')) return Promise.resolve(answer());
      if (input.startsWith('/api/v1/branding')) return Promise.resolve(json({ error: {} }, 404));
      return Promise.resolve(json({ error: {} }, 404));
    }),
  );
  return calls;
}

const renderAt = (path: string) => {
  window.history.pushState({}, '', path);
  return render(
    <StrictMode>
      <App i18n={createI18n(() => undefined)} />
    </StrictMode>,
  );
};

beforeAll(warmLazyModules, WARM_UP_BUDGET_MS);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('public verification page', () => {
  it('answers without a session and shows only the public fields', async () => {
    const calls = stubFetch(() => json(valid));
    renderAt(`/verify/${TOKEN}`);
    await screen.findByRole('heading', { level: 1, name: 'التحقق من مستند' }, FIRST_RENDER);
    await screen.findByText('صدر إصدار أحدث من هذا المستند');
    expect(screen.getByText('إيصال استلام')).toBeTruthy();
    expect(screen.getByText('RCP-2026-00007')).toBeTruthy();
    expect(screen.getByText('1820-BA36-5537-8316')).toBeTruthy();
    expect(screen.getByText('شركة تجريبية')).toBeTruthy();

    // No session probe, no refresh cookie, no sign-in screen.
    expect(calls.some((call) => call.path.startsWith('/api/v1/auth'))).toBe(false);
    expect(calls.some((call) => call.path.startsWith('/api/v1/me'))).toBe(false);
    const verification = calls.find((call) => call.path.startsWith('/api/v1/public/verify/'));
    expect(verification?.path).toBe(`/api/v1/public/verify/${TOKEN}`);
    expect(verification?.init?.credentials).toBe('omit');
    expect(screen.queryByLabelText(/كلمة المرور/u)).toBeNull();
  });

  it('shows no document fields for an unknown code', async () => {
    stubFetch(() => json({ result: 'invalid', checkedAt: '2026-09-29T08:00:00.000Z' }));
    renderAt('/verify/not-a-real-code');
    await screen.findByText('لم يتم العثور على مستند بهذا الرمز', {}, FIRST_RENDER);
    expect(screen.getByTestId('verification-result').dataset['result']).toBe('invalid');
    expect(screen.queryByText('الرقم المرجعي')).toBeNull();
    expect(screen.queryByText('البصمة')).toBeNull();
  });

  it('says so when the address is throttled, and reads in English', async () => {
    stubFetch(() => json({ error: { code: 'RATE_LIMITED' } }, 429));
    renderAt(`/verify/${TOKEN}`);
    await screen.findByText(
      'طلبات تحقق كثيرة من هذا الجهاز. انتظر دقيقة ثم أعد المحاولة.',
      {},
      FIRST_RENDER,
    );
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    await screen.findByRole('heading', { level: 1, name: 'Document verification' });
    expect(document.documentElement.dir).toBe('ltr');
  });
});
