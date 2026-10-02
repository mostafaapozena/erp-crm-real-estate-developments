import type { BusinessDate, Instant, Money } from '@alola/contracts';
import { createFormatters } from '@alola/i18n';
import { useMemo } from 'react';
import { useBranding } from './branding';
import { useLocale } from './locale';

/**
 * Display formatting, always through the shared formatters (`SD-23`, ADR-0003).
 *
 * Never `toLocaleString` at a call site: `ar-EG` produces Arabic-Indic digits by default, and the
 * approved rule is Western digits in both languages. `createFormatters` forces `-u-nu-latn` and
 * assembles dates as `dd/MM/yyyy`, so a screen that uses this hook cannot get either wrong.
 */

export interface Formatters {
  money: (value: Money | undefined, fractionDigits?: number) => string;
  /** A count, a percentage point, an area — anything that is a number but not money. */
  number: (value: number | string | undefined, fractionDigits?: number) => string;
  percent: (fraction: number | string | undefined) => string;
  date: (value: BusinessDate | string | undefined) => string;
  dateTime: (value: Instant | string | undefined) => string;
}

/** Shown wherever a value is genuinely absent, so an empty cell is never mistaken for a zero. */
const ABSENT = '—';

export function useFormatters(): Formatters {
  const { locale } = useLocale();
  // The deployment's timezone, from its branding (ADR-0008, ADR-0027) — never assumed by the client.
  const { timeZone } = useBranding();
  return useMemo(() => {
    const base = createFormatters(locale, { timeZone });
    return {
      money: (value, fractionDigits = 2) => (value ? base.money(value, fractionDigits) : ABSENT),
      number: (value, fractionDigits) =>
        value === undefined || value === null ? ABSENT : base.number(value, fractionDigits),
      percent: (fraction) =>
        fraction === undefined || fraction === null ? ABSENT : base.percent(fraction),
      date: (value) => (value ? base.businessDate(value as BusinessDate) : ABSENT),
      dateTime: (value) => (value ? base.instant(value as Instant) : ABSENT),
    };
  }, [locale, timeZone]);
}

/**
 * Today in the organization's calendar, as a business date. A form that defaults a date — a contract
 * date, a validity — uses this rather than the browser's UTC clock, which names the wrong day for the
 * last hours of every evening east of Greenwich (ADR-0008).
 */
export function useToday(): BusinessDate {
  const { timeZone } = useBranding();
  // The same calculation as the contracts' businessDateInZone, done here so the start-up bundle does
  // not import the contracts' runtime (and Zod with it) for one date.
  return useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}` as BusinessDate;
  }, [timeZone]);
}
