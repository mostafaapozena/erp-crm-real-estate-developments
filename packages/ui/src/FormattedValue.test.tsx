import { createFormatters } from '@alola/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormattedValue, ValueRange, isolationDirection } from './FormattedValue';
import { ThemeRoot } from './ThemeRoot';

/**
 * RTL-safe display of formatted values (I18N-005). The formatters produce correct logical strings;
 * these tests pin how they are isolated, which is where the review's defects were: `%24.62`, a money
 * unit reordered inside a left-to-right isolate, a currency wrapped away from its number, a range
 * separator at the wrong edge.
 */
afterEach(cleanup);

const ar = createFormatters('ar', { timeZone: 'UTC' });
const en = createFormatters('en', { timeZone: 'UTC' });
/** Money as the formatter takes it; the decimal string is branded, so the test builds it once here. */
const egp = (amount: string) => ({ amount, currency: 'EGP' }) as Parameters<typeof ar.money>[0];

const bdiOf = (text: string) => {
  const element = screen.getByText(text, { exact: true });
  const bdi = element.tagName === 'BDI' ? element : element.closest('bdi');
  if (!bdi) throw new Error(`no isolate around ${text}`);
  return bdi;
};

describe('isolation direction follows the content', () => {
  it('isolates a percentage left-to-right in both languages, so it reads 24.62%', () => {
    expect(ar.percent('0.2462')).toBe('24.62%');
    expect(isolationDirection(ar.percent('0.2462'))).toBe('ltr');
    expect(isolationDirection(en.percent('0.2462'))).toBe('ltr');
  });

  it('isolates Arabic money right-to-left and English money left-to-right', () => {
    const arabic = ar.money(egp('4000000'), 2);
    // A non-breaking space joins the number and its unit: the pair can never wrap apart.
    expect(arabic).toBe('4,000,000.00 ج.م.');
    expect(isolationDirection(arabic)).toBe('rtl');
    expect(isolationDirection(en.money(egp('4000000'), 2))).toBe('ltr');
  });

  it('keeps technical identifiers left-to-right', () => {
    for (const value of [
      'CTR-2026-00002',
      '+201000001012',
      'walid@demo.invalid',
      'EG38001900050',
    ]) {
      expect(isolationDirection(value)).toBe('ltr');
    }
  });
});

describe('FormattedValue', () => {
  it('renders a percentage inside an LTR isolate that never wraps', () => {
    render(
      <ThemeRoot locale="ar">
        <p>
          نسبة التحصيل: <FormattedValue>{ar.percent('0.2462')}</FormattedValue>
        </p>
      </ThemeRoot>,
    );
    const bdi = bdiOf('24.62%');
    expect(bdi.getAttribute('dir')).toBe('ltr');
    expect(getComputedStyle(bdi).whiteSpace).toBe('nowrap');
  });

  it('keeps an Arabic amount and its currency unit together, right-to-left', () => {
    const value = ar.money(egp('5500000'), 2);
    render(
      <ThemeRoot locale="ar">
        <FormattedValue>{value}</FormattedValue>
      </ThemeRoot>,
    );
    const bdi = document.querySelector('bdi');
    expect(bdi?.textContent).toBe(value);
    expect(bdi?.getAttribute('dir')).toBe('rtl');
    expect(getComputedStyle(bdi as Element).whiteSpace).toBe('nowrap');
  });

  it('keeps a negative amount with its sign attached', () => {
    const value = ar.money(egp('-12.5'), 2);
    // The formatter's one retained mark: a left-to-right mark before the minus sign.
    expect(value.startsWith('\u200E-12.50')).toBe(true);
    render(
      <ThemeRoot locale="ar">
        <FormattedValue>{value}</FormattedValue>
      </ThemeRoot>,
    );
    expect(document.querySelector('bdi')?.textContent).toBe(value);
  });

  it('lets a long e-mail address wrap instead of overflowing a narrow container', () => {
    const email = 'collections.department@alola-developments.demo.invalid';
    render(<FormattedValue>{email}</FormattedValue>);
    const bdi = bdiOf(email);
    expect(bdi.getAttribute('dir')).toBe('ltr');
    expect(getComputedStyle(bdi).whiteSpace).not.toBe('nowrap');
  });

  it('adds no invisible control characters, so a copied value is exactly the value', () => {
    render(<FormattedValue>CTR-2026-00002</FormattedValue>);
    expect(document.querySelector('bdi')?.textContent).toBe('CTR-2026-00002');
  });
});

describe('ValueRange', () => {
  it.each([
    ['ar', ar, 'إلى'],
    ['en', en, 'to'],
  ] as const)('keeps the separator between two whole values (%s)', (locale, format, word) => {
    const from = format.money(egp('4000000'), 2);
    const to = format.money(egp('5500000'), 2);
    render(
      <ThemeRoot locale={locale}>
        <ValueRange from={from} to={to} spokenSeparator={word} />
      </ThemeRoot>,
    );
    const range = document.querySelector('[data-range]');
    const parts = [...(range?.children ?? [])];
    // Logical order: first value, visual dash, spoken separator, second value. Laid out in the
    // inline direction, the dash therefore sits between the values in RTL and LTR alike.
    expect(parts.map((part) => part.textContent?.trim())).toEqual([from, '–', word, to]);
    expect(parts[1]?.getAttribute('aria-hidden')).toBe('true');
    for (const value of [parts[0], parts[3]]) {
      expect(value?.tagName).toBe('BDI');
      expect(getComputedStyle(value as Element).whiteSpace).toBe('nowrap');
    }
    // It may wrap only between whole values.
    expect(getComputedStyle(range as Element).flexWrap).toBe('wrap');
  });
});
