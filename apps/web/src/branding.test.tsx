import type { PublicBranding } from '@alola/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { NEUTRAL_BRANDING, loadBranding } from './branding';
import { createI18n } from './i18n';

/**
 * Runtime branding (PLAT-023, ADR-0027): one build, many deployments, each with its own identity read
 * when the page loads. Nothing here is compiled in, and every failure falls back to the neutral name.
 */
function serve(branding: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input === '/api/v1/branding') {
        return Promise.resolve(
          new Response(JSON.stringify(branding), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error('no server'));
    }),
  );
}

const configured: PublicBranding = {
  configured: true,
  demonstration: false,
  shortName: { ar: 'شركة المثال', en: 'Example Homes' },
  tradeName: { ar: 'شركة المثال للتطوير', en: 'Example Homes Development' },
  defaultLocale: 'ar',
  supportedLocales: ['ar', 'en'],
  timeZone: 'Africa/Cairo',
  primaryColor: '#0F766E',
  assets: {
    logo: { url: '/api/v1/branding/assets/logo?v=0123456789abcdef', contentType: 'image/png' },
    favicon: {
      url: '/api/v1/branding/assets/favicon?v=0123456789abcdef',
      contentType: 'image/png',
    },
  },
  version: 3,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
});

describe('runtime branding', () => {
  it('names the tab after the company and shows its logo with the name as its text alternative', async () => {
    serve(configured);
    render(<App i18n={createI18n(() => undefined)} />);
    await screen.findByRole('heading', { level: 1, name: 'تسجيل الدخول' });
    expect(document.title).toBe('شركة المثال');
    // The logo's text alternative is the display name shown with it on the sign-in screen.
    expect(screen.getByRole('img', { name: 'شركة المثال للتطوير' }).getAttribute('src')).toBe(
      configured.assets.logo?.url,
    );
    expect(screen.getByText('نظام إدارة التطوير العقاري')).toBeDefined();
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(
      configured.assets.favicon?.url,
    );
  });

  it('never claims a live deployment is a demonstration', async () => {
    serve(configured);
    render(<App i18n={createI18n(() => undefined)} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/تجريبي|تجريبية/)).toBeNull();
  });

  it('starts in the deployment language and offers no switch when it offers one language', async () => {
    serve({ ...configured, defaultLocale: 'en', supportedLocales: ['en'] });
    render(<App i18n={createI18n(() => undefined)} />);
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.queryByRole('button', { name: 'العربية' })).toBeNull();
  });

  it('falls back to the neutral identity on a malformed answer', async () => {
    serve({ configured: true, defaultLocale: 'fr' });
    render(<App i18n={createI18n(() => undefined)} />);
    await screen.findByRole('heading', { level: 1, name: 'تسجيل الدخول' });
    expect(document.title).toBe('نظام إدارة التطوير العقاري');
  });

  it('draws a monogram from the brand colour when no logo is configured', async () => {
    serve({ ...configured, assets: {} });
    render(<App i18n={createI18n(() => undefined)} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('brand-logo')).toBeNull();
    expect(screen.getByTestId('brand-monogram').textContent).toBe('م');
    expect(screen.getByText('شركة المثال للتطوير')).toBeDefined();
  });

  it('falls back to the neutral identity when the API refuses', async () => {
    serve({}, 503);
    await expect(loadBranding()).resolves.toBe(NEUTRAL_BRANDING);
  });
});
