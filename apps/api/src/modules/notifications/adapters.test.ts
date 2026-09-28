import { describe, expect, it } from 'vitest';
import { SimulatedChannelAdapter, UnconfiguredChannelAdapter, quietHoursRelease } from './adapters';

/** CORE-NOTIFY-004: quiet hours are local times in the organization's timezone. */
describe('quietHoursRelease', () => {
  const cairo = 'Africa/Cairo'; // UTC+3 on these dates
  const overnight = { start: '22:00', end: '07:00' };

  it('releases at the end of a window that wraps midnight', () => {
    expect(
      quietHoursRelease(new Date('2026-09-28T21:30:00Z'), cairo, overnight)?.toISOString(),
    ).toBe('2026-09-29T04:00:00.000Z');
    expect(
      quietHoursRelease(new Date('2026-09-29T03:59:00Z'), cairo, overnight)?.toISOString(),
    ).toBe('2026-09-29T04:00:00.000Z');
  });

  it('holds nothing outside the window, at its end, or when none is configured', () => {
    expect(quietHoursRelease(new Date('2026-09-28T10:00:00Z'), cairo, overnight)).toBeUndefined();
    expect(quietHoursRelease(new Date('2026-09-29T04:00:00Z'), cairo, overnight)).toBeUndefined();
    expect(quietHoursRelease(new Date('2026-09-28T21:30:00Z'), cairo, null)).toBeUndefined();
  });

  it('handles a window within one day', () => {
    const afternoon = { start: '13:00', end: '15:00' };
    expect(
      quietHoursRelease(new Date('2026-09-28T10:30:00Z'), cairo, afternoon)?.toISOString(),
    ).toBe('2026-09-28T12:00:00.000Z');
    expect(quietHoursRelease(new Date('2026-09-28T12:00:00Z'), cairo, afternoon)).toBeUndefined();
  });
});

describe('channel adapters (CORE-NOTIFY-002)', () => {
  it('refuses to send without a provider', async () => {
    await expect(new UnconfiguredChannelAdapter('whatsapp').send()).rejects.toThrow(/No provider/);
  });

  it('simulates only in development and test, and never claims to be connected', () => {
    expect(() => new SimulatedChannelAdapter('whatsapp', 'production')).toThrow();
    expect(() => new SimulatedChannelAdapter('whatsapp', 'staging')).toThrow();
    expect(new SimulatedChannelAdapter('whatsapp', 'test').connected).toBe(false);
  });
});
