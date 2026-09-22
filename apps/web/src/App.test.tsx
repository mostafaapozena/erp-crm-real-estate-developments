import { StateView } from '@alola/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { createI18n } from './i18n';

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

/**
 * The web unit tier.
 *
 * It exercises the **signed-out** application, which is the only part that renders without a server:
 * `App` restores a session from the refresh cookie on mount, and with `fetch` refusing there is no
 * session, so the sign-in screen is what renders. That is exactly the surface worth asserting here —
 * language, direction, fonts and the five interface states — while everything behind authentication
 * is covered by the E2E suite against the real API.
 */
function renderApp() {
  const missing: string[] = [];
  const i18n = createI18n((key) => missing.push(key));
  render(<App i18n={i18n} />);
  return { missing };
}

/**
 * Visible text excluding elements explicitly marked with another language (the language switch shows
 * the target language's own name) and LTR-isolated values (phone, email).
 */
function textInCurrentLanguage(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  const pageLang = document.documentElement.lang;
  clone.querySelectorAll('[lang], bdi').forEach((el) => {
    if (el.tagName === 'BDI' || el.getAttribute('lang') !== pageLang) el.remove();
  });
  return clone.textContent;
}

beforeEach(() => {
  // No server in this tier: the session restore fails and the sign-in screen renders.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no server in the unit tier'))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('web shell (I18N-003, TEST-003 unit tier)', () => {
  it('starts in Arabic, right-to-left, with no missing keys', async () => {
    const { missing } = renderApp();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.title).toBe('نظام إدارة التطوير العقاري');
    await screen.findByRole('heading', { level: 1, name: 'تسجيل الدخول' });
    expect(missing).toEqual([]);
  });

  it('shows no English words while in Arabic', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1 });
    // The language switch is marked `lang="en"` and is excluded, as are direction-isolated values.
    expect(textInCurrentLanguage()).not.toMatch(LATIN_WORD);
  });

  it('switches language and direction together, with no Arabic left on screen', async () => {
    const { missing } = renderApp();
    await screen.findByRole('heading', { level: 1 });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
    });
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.title).toBe('Real Estate Development ERP');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in');
    expect(textInCurrentLanguage()).not.toMatch(ARABIC);
    expect(missing).toEqual([]);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    });
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('تسجيل الدخول');
  });

  it('states on the sign-in screen that this is a demonstration environment', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1 });
    // The boundary has to be visible before anyone signs in, not only inside the product (ADR-0026).
    expect(document.body.textContent).toContain('بيئة عرض تجريبي');
  });

  it('keeps credential fields left-to-right whatever the interface language is', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1 });
    const identifier = screen.getByLabelText(/البريد الإلكتروني/);
    expect(identifier.getAttribute('dir')).toBe('ltr');
  });

  it('renders no session-only navigation while signed out', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'التنقل الرئيسي' })).toBeNull();
  });
});

describe('language switch on the sign-in screen', () => {
  it('labels the switch with the target language in that language', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1 });
    const button = screen.getByRole('button', { name: 'English' });
    expect(button.getAttribute('lang')).toBe('en');
  });
});

describe('interface states (THEME-010)', () => {
  it('renders all five', () => {
    render(
      <>
        {(['loading', 'empty', 'error', 'forbidden', 'success'] as const).map((kind) => (
          <StateView key={kind} kind={kind} title={kind} />
        ))}
      </>,
    );
    for (const state of ['loading', 'empty', 'error', 'forbidden', 'success']) {
      expect(document.querySelector(`[data-state="${state}"]`)).not.toBeNull();
    }
  });
});

describe('RouteErrorBoundary', () => {
  function Boom(): never {
    throw new Error('chunk failed to load');
  }

  it('renders a retry instead of a blank page when a route fails', () => {
    // React logs the caught error; silence it so a passing run has no red output.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <RouteErrorBoundary title="Something went wrong" description="Try again" retryLabel="Retry">
        <Boom />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    consoleError.mockRestore();
  });

  it('renders its children when nothing fails', () => {
    render(
      <RouteErrorBoundary title="t" description="d" retryLabel="r">
        <p>content</p>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('content')).not.toBeNull();
  });

  it('reports the failure rather than swallowing it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    render(
      <RouteErrorBoundary title="t" description="d" retryLabel="r" onError={onError}>
        <Boom />
      </RouteErrorBoundary>,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    consoleError.mockRestore();
  });
});
