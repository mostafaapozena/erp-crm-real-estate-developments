import { describe, expect, it } from 'vitest';
import { signHmacSha256, verifyHmacSha256 } from './adapters';

/** INTEGRATION-004: the signature scheme adapters build on. */
describe('verifyHmacSha256', () => {
  const body = Buffer.from('{"id":"evt_1"}');
  const now = new Date('2026-10-01T09:00:00.000Z');
  const timestamp = String(now.getTime() / 1000);
  const secret = 'whsec_test_value';
  const signature = signHmacSha256(body, timestamp, secret);
  const check = (overrides: Partial<Parameters<typeof verifyHmacSha256>[0]>) =>
    verifyHmacSha256({ rawBody: body, signature, timestamp, secret, now, ...overrides });

  it('accepts the exact bytes, signed with the secret, within the tolerance', () => {
    expect(check({})).toBe(true);
    expect(check({ signature: signature.replace('sha256=', '') })).toBe(true);
  });

  it('refuses a changed body, a wrong secret, a forged or missing signature', () => {
    expect(check({ rawBody: Buffer.from('{"id":"evt_2"}') })).toBe(false);
    expect(check({ rawBody: Buffer.from('{"id": "evt_1"}') })).toBe(false);
    expect(check({ secret: 'other' })).toBe(false);
    expect(check({ signature: `sha256=${'0'.repeat(64)}` })).toBe(false);
    expect(check({ signature: 'sha256=zz' })).toBe(false);
    expect(check({ signature: undefined })).toBe(false);
    expect(check({ secret: undefined })).toBe(false);
  });

  it('refuses an old capture replayed outside the tolerance', () => {
    expect(check({ now: new Date(now.getTime() + 301_000) })).toBe(false);
    expect(check({ now: new Date(now.getTime() + 299_000) })).toBe(true);
    expect(check({ timestamp: 'yesterday' })).toBe(false);
  });
});
