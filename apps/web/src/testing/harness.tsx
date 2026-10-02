import { render } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { SessionProvider } from '../api/session';
import { BrandingProvider } from '../branding';
import { createI18n } from '../i18n';
import { LocaleProvider } from '../locale';
import { PeopleProvider } from '../people';

/**
 * A light harness for one screen: the providers a page needs and a router at one address — not the
 * whole lazily loaded shell, which is what makes a first render slow on a busy machine. The fetch
 * stub answers by path and records every request, so a test can assert what was (and was not) asked.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const testSession = (permissions: string[]) => ({
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
    level: 'all',
    teamIds: [],
    departmentIds: [],
    branchIds: [],
    projectIds: [],
    legalEntityIds: [],
  },
});

export interface Recorded {
  method: string;
  path: string;
  query: string;
  body: unknown;
}

/**
 * Stub `fetch`. `routes` answers GETs by path; `writes` answers other methods by `METHOD path`, and
 * may be a function of the body. Anything unanswered is a 404, so a request the screen should not
 * make shows up in `requests` rather than silently succeeding.
 */
export function stubApi(
  permissions: string[],
  routes: Record<string, unknown>,
  writes: Record<string, unknown> = {},
): Recorded[] {
  const requests: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const [path = input, query = ''] = input.split('?');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, path, query, body });
      const base: Record<string, unknown> = {
        '/api/v1/auth/refresh': { accessToken: 'access-token' },
        '/api/v1/me': testSession(permissions),
        '/api/v1/organization/people': { items: [] },
        ...routes,
      };
      if (method !== 'GET' && path !== '/api/v1/auth/refresh') {
        const answer = writes[`${method} ${path}`];
        if (typeof answer === 'function')
          return Promise.resolve((answer as (b: unknown) => Response)(body));
        return Promise.resolve(answer === undefined ? json({ error: {} }, 404) : json(answer));
      }
      const answer = base[path];
      return Promise.resolve(answer === undefined ? json({ error: {} }, 404) : json(answer));
    }),
  );
  return requests;
}

/** Render one page at an address, under the route pattern it expects. */
export function renderAt(element: ReactElement, address: string, pattern: string) {
  return render(
    <StrictMode>
      <BrandingProvider>
        <LocaleProvider i18n={createI18n(() => undefined)}>
          <SessionProvider>
            <PeopleProvider>
              <MemoryRouter initialEntries={[address]}>
                <Routes>
                  <Route path={pattern} element={element} />
                  <Route path="*" element={<div data-testid="navigated" />} />
                </Routes>
              </MemoryRouter>
            </PeopleProvider>
          </SessionProvider>
        </LocaleProvider>
      </BrandingProvider>
    </StrictMode>,
  );
}
