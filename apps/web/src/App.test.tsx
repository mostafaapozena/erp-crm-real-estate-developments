import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createI18n } from './i18n';

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

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

afterEach(cleanup);

describe('web shell (I18N-003, TEST-003 unit tier)', () => {
  it('starts in Arabic, right-to-left, with no missing keys', () => {
    const { missing } = renderApp();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.title).toBe('نظام العلا');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('أساس المنصة');
    expect(missing).toEqual([]);
  });

  it('shows no English words while in Arabic', () => {
    renderApp();
    expect(textInCurrentLanguage()).not.toMatch(LATIN_WORD);
  });

  it('switches language and direction together, with no Arabic left on screen', () => {
    const { missing } = renderApp();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
    });
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Platform foundation');
    expect(textInCurrentLanguage()).not.toMatch(ARABIC);
    expect(missing).toEqual([]);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    });
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('uses Arabic plural rules', () => {
    renderApp();
    expect(screen.getByTestId('plural-sample').textContent).toBe('3 عناصر');
  });

  it('isolates LTR values inside RTL text', () => {
    renderApp();
    const phone = screen.getByText('+201001234567');
    expect(phone.tagName).toBe('BDI');
    expect(phone.getAttribute('dir')).toBe('ltr');
  });

  it('shows a clearly labelled temporary logo placeholder in development only', () => {
    renderApp();
    expect(screen.getByTestId('dev-logo-placeholder').textContent).toContain('مؤقت');
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders all five interface states', () => {
    renderApp();
    for (const state of ['loading', 'empty', 'error', 'forbidden', 'success']) {
      expect(document.querySelector(`[data-state="${state}"]`)).not.toBeNull();
    }
  });
});
