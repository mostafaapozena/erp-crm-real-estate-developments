import type { BusinessDate, Instant, Money } from '@alola/contracts';
import { createFormatters } from '@alola/i18n';
import { useMemo } from 'react';
import { useLocale } from './locale';

/**
 * Display formatting, always through the shared formatters (`SD-23`, ADR-0003).
 *
 * Never `toLocaleString` at a call site: `ar-EG` produces Arabic-Indic digits by default, and the
 * approved rule is Western digits in both languages. `createFormatters` forces `-u-nu-latn` and
 * assembles dates as `dd/MM/yyyy`, so a screen that uses this hook cannot get either wrong.
 */

/**
 * The organization timezone used for display.
 *
 * A single value for the demonstration. It belongs to the legal entity, which already stores its own
 * `timeZone`; a multi-entity deployment resolves it per record rather than from a constant, and this
 * is the one place that would change.
 */
export const DISPLAY_TIME_ZONE = 'Africa/Cairo';

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
  return useMemo(() => {
    const base = createFormatters(locale, { timeZone: DISPLAY_TIME_ZONE });
    return {
      money: (value, fractionDigits = 2) => (value ? base.money(value, fractionDigits) : ABSENT),
      number: (value, fractionDigits) =>
        value === undefined || value === null ? ABSENT : base.number(value, fractionDigits),
      percent: (fraction) =>
        fraction === undefined || fraction === null ? ABSENT : base.percent(fraction),
      date: (value) => (value ? base.businessDate(value as BusinessDate) : ABSENT),
      dateTime: (value) => (value ? base.instant(value as Instant) : ABSENT),
    };
  }, [locale]);
}
