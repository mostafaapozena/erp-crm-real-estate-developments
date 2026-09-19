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

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
