import type { BusinessDate, Instant, Locale, Money } from '@alola/contracts';

/**
 * Display formatting (I18N-006) under the approved digit rule (SD-23, ADR-0003 status update).
 *
 * - **Western digits (0–9) in both Arabic and English.** Every `Intl` formatter is created with the
 *   `-u-nu-latn` extension, so no locale default can switch Arabic to Arabic-Indic digits.
 * - Locale-aware separators and currency labels come from CLDR: Arabic `1,234.50`, `250,000 ج.م.`;
 *   English `1,234.50`, `EGP 250,000`.
 * - Dates are numeric `dd/MM/yyyy` (and `dd/MM/yyyy HH:mm`, 24-hour) in both languages. Western digits
 *   joined by `/` keep their order inside right-to-left text, so an Arabic screen reads `15/09/2026`.
 *   Month names are not used, which also keeps output identical across ICU versions.
 * - ICU's invisible bidi marks are removed so output is deterministic, **except** one leading
 *   left-to-right mark on negative numbers, which keeps the minus sign attached in RTL text.
 * - Display only: stored and API values stay language-neutral (decimal strings, ISO dates) and are
 *   never converted to Arabic-Indic characters.
 * - Instants display in the **organization** timezone, passed in explicitly (ADR-0008). Business dates
 *   are calendar dates and are never shifted through a timezone.
 */
export interface FormatterOptions {
  timeZone: string;
}

export interface Formatters {
  instant(value: Instant, style?: 'date' | 'dateTime'): string;
  businessDate(value: BusinessDate): string;
  /** Without `fractionDigits`, shows the value's own precision; with it, a fixed number of places. */
  number(value: number | string, fractionDigits?: number): string;
  percent(fraction: number | string): string;
  money(value: Money, fractionDigits: number): string;
}

const LRM = '\u200E';
const BIDI_MARKS = /[\u200E\u200F\u061C\u2066-\u2069]/g;

/** Locale tag with Western digits forced (SD-23). */
export function formattingLocale(locale: Locale): string {
  return `${locale}-u-nu-latn`;
}

function clean(text: string): string {
  const stripped = text.replace(BIDI_MARKS, '');
  return stripped.startsWith('-') ? `${LRM}${stripped}` : stripped;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function createFormatters(locale: Locale, options: FormatterOptions): Formatters {
  const tag = formattingLocale(locale);

  // Used only to resolve date and time fields in the organization timezone; assembled below.
  const zonedParts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const percentFormat = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 2 });

  function instant(value: Instant, style: 'date' | 'dateTime' = 'dateTime'): string {
    const parts = Object.fromEntries(
      zonedParts.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const date = `${pad(Number(parts['day']))}/${pad(Number(parts['month']))}/${parts['year']}`;
    return style === 'date'
      ? date
      : `${date} ${pad(Number(parts['hour']) % 24)}:${pad(Number(parts['minute']))}`;
  }

  return {
    instant,
    businessDate: (value) => {
      const [year, month, day] = value.split('-');
      return `${day}/${month}/${year}`;
    },
    number: (value, fractionDigits) =>
      clean(
        new Intl.NumberFormat(tag, {
          minimumFractionDigits: fractionDigits ?? 0,
          maximumFractionDigits: fractionDigits ?? 20,
        }).format(value as Intl.StringNumericLiteral),
      ),
    percent: (fraction) => clean(percentFormat.format(fraction as Intl.StringNumericLiteral)),
    money: (value, fractionDigits) =>
      clean(
        new Intl.NumberFormat(tag, {
          style: 'currency',
          currency: value.currency,
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }).format(value.amount as Intl.StringNumericLiteral),
      ),
  };
}
