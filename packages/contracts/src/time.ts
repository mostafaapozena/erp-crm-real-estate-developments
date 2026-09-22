import { z } from 'zod';

/**
 * Two distinct time types (PLAT-013, ADR-0008). They are branded so that passing one where the other
 * is expected fails typecheck.
 *
 * - `Instant`: a moment in time, always UTC, ISO-8601 with `Z`. Stored as a UTC timestamp.
 * - `BusinessDate`: a calendar date with no time and no zone (`YYYY-MM-DD`) — a due date, a contract
 *   date. Never stored as a timestamp, because converting it through a timezone shifts the day.
 */

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const InstantSchema = z
  .string()
  .regex(INSTANT, { message: 'INSTANT_EXPECTED' })
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'INSTANT_EXPECTED' })
  .brand<'Instant'>();
export type Instant = z.infer<typeof InstantSchema>;

export const BusinessDateSchema = z
  .string()
  .refine(isValidBusinessDate, { message: 'BUSINESS_DATE_EXPECTED' })
  .brand<'BusinessDate'>();
export type BusinessDate = z.infer<typeof BusinessDateSchema>;

function isValidBusinessDate(value: string): boolean {
  const match = BUSINESS_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function instantFromDate(date: Date): Instant {
  return date.toISOString() as Instant;
}

export function nowInstant(): Instant {
  return instantFromDate(new Date());
}

/** The calendar date on which `instant` falls in `timeZone` (an IANA zone such as the org timezone). */
export function businessDateInZone(instant: Instant, timeZone: string): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return BusinessDateSchema.parse(`${part('year')}-${part('month')}-${part('day')}`);
}

/**
 * Add whole months to a business date, **clamping** the day to the target month's length.
 *
 * This is the single most error-prone piece of arithmetic in an installment schedule. A contract
 * signed on the 31st with monthly installments has no 31 February, and the two wrong answers are both
 * common: overflowing into 3 March (which silently moves a due date past month end and breaks every
 * "due this month" report) or subtracting a day each time (which drifts the whole schedule earlier).
 * Clamping to the last day of the target month is what a person means by "the same date next month",
 * and it is stable: 31 Jan → 28 Feb → 31 Mar, never 28 Mar.
 */
export function addMonths(date: BusinessDate, months: number): BusinessDate {
  if (!Number.isInteger(months)) throw new Error('addMonths expects a whole number of months');
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const zeroBased = y * 12 + (m - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = zeroBased - year * 12;
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const pad = (value: number) => String(value).padStart(2, '0');
  return BusinessDateSchema.parse(`${String(year).padStart(4, '0')}-${pad(month + 1)}-${pad(day)}`);
}

/** Add whole days to a business date. No timezone is involved, so no day can be skipped. */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  if (!Number.isInteger(days)) throw new Error('addDays expects a whole number of days');
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (value: number) => String(value).padStart(2, '0');
  return BusinessDateSchema.parse(
    `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
  );
}

/** Negative when `a` is before `b`. Business dates compare as strings, but this states the intent. */
export function compareBusinessDates(a: BusinessDate, b: BusinessDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
