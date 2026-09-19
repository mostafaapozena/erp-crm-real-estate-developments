import { describe, expect, it } from 'vitest';
import {
  BusinessDateSchema,
  InstantSchema,
  businessDateInZone,
  instantFromDate,
  isValidTimeZone,
  type BusinessDate,
  type Instant,
} from './time';

describe('time types (PLAT-013)', () => {
  it('runs the test process in UTC', () => {
    expect(process.env['TZ']).toBe('UTC');
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });

  it('accepts only UTC ISO-8601 instants', () => {
    expect(InstantSchema.safeParse('2026-09-19T10:00:00.000Z').success).toBe(true);
    expect(InstantSchema.safeParse('2026-09-19T10:00:00+02:00').success).toBe(false);
    expect(InstantSchema.safeParse('2026-09-19').success).toBe(false);
  });

  it('accepts only real calendar dates as business dates', () => {
    expect(BusinessDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(BusinessDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(BusinessDateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(BusinessDateSchema.safeParse('2026-09-19T00:00:00Z').success).toBe(false);
  });

  it('derives the business date in a named zone, not the server zone', () => {
    const instant = instantFromDate(new Date('2026-09-19T22:30:00.000Z'));
    expect(businessDateInZone(instant, 'UTC')).toBe('2026-09-19');
    expect(businessDateInZone(instant, 'Asia/Tokyo')).toBe('2026-09-20');
    expect(businessDateInZone(instant, 'America/New_York')).toBe('2026-09-19');
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('keeps Instant and BusinessDate distinct at the type level', () => {
    const date = BusinessDateSchema.parse('2026-09-19');
    const instant = InstantSchema.parse('2026-09-19T00:00:00.000Z');
    // @ts-expect-error — a BusinessDate is not an Instant.
    const wrongInstant: Instant = date;
    // @ts-expect-error — an Instant is not a BusinessDate.
    const wrongDate: BusinessDate = instant;
    // @ts-expect-error — a plain string is neither.
    const plain: BusinessDate = '2026-09-19';
    expect([wrongInstant, wrongDate, plain]).toHaveLength(3);
  });
});
