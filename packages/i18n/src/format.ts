import type { BusinessDate, Instant, Locale, Money } from '@alola/contracts';

/**
 * Locale-aware formatting via `Intl`, never hand-rolled (I18N-006).
 *
 * - Instants display in the **organization** timezone, passed in explicitly — never the browser's or
 *   the server's zone (ADR-0008).
 * - Business dates are formatted as calendar dates with no timezone conversion, so a due date never
 *   shifts by a day.
 * - Money is formatted from its decimal **string**, which modern `Intl.NumberFormat` handles exactly.
 *   Fraction digits come from the currency's configured precision, never a hard-coded 2.
 * - Digit shape follows the locale's CLDR default consistently. Choosing Western or Arabic-Indic digits
 *   for Arabic is an open presentation decision; when made, it is set here, in one place.
 */
export interface FormatterOptions {
  timeZone: string;
}

export interface Formatters {
  instant(value: Instant, style?: 'date' | 'dateTime'): string;
  businessDate(value: BusinessDate): string;
  number(value: number | string): string;
  percent(fraction: number | string): string;
  money(value: Money, fractionDigits: number): string;
}

export function createFormatters(locale: Locale, options: FormatterOptions): Formatters {
  const dateFormat = new Intl.DateTimeFormat(locale, {
    timeZone: options.timeZone,
    dateStyle: 'medium',
  });
  const dateTimeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: options.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const businessDateFormat = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    dateStyle: 'medium',
  });
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 20 });
  const percentFormat = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 2,
  });

  return {
    instant: (value, style = 'dateTime') =>
      (style === 'date' ? dateFormat : dateTimeFormat).format(new Date(value)),
    // A business date is a calendar date: format it as midnight UTC in UTC so no offset applies.
    businessDate: (value) => businessDateFormat.format(new Date(`${value}T00:00:00Z`)),
    number: (value) => numberFormat.format(value as Intl.StringNumericLiteral),
    percent: (fraction) => percentFormat.format(fraction as Intl.StringNumericLiteral),
    money: (value, fractionDigits) =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: value.currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value.amount as Intl.StringNumericLiteral),
  };
}
