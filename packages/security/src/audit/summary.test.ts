import { describe, expect, it } from 'vitest';
import { REDACTED } from '../logging';
import { buildChangeSummary, summarizeValue } from './summary';

describe('audit change summaries (AUDIT-002, AUDIT-006)', () => {
  it('records only the paths that changed', () => {
    const summary = buildChangeSummary(
      { roleKeys: ['auditor'], scope: { level: 'self' }, note: 'same' },
      { roleKeys: ['auditor', 'admin'], scope: { level: 'branch' }, note: 'same' },
    );
    expect(summary.map((entry) => entry.path).sort()).toEqual(['roleKeys', 'scope.level']);
    expect(summary.find((entry) => entry.path === 'scope.level')).toEqual({
      path: 'scope.level',
      from: 'self',
      to: 'branch',
    });
  });

  it('marks creation and removal explicitly', () => {
    const created = buildChangeSummary(undefined, { key: 'auditor' });
    expect(created).toEqual([{ path: 'key', to: 'auditor' }]);
    const removed = buildChangeSummary({ key: 'auditor' }, undefined);
    expect(removed).toEqual([{ path: 'key', from: 'auditor' }]);
  });

  it.each([
    'password',
    'passwordHash',
    'refreshToken',
    'accessToken',
    'apiKey',
    'clientSecret',
    'cookie',
    'authorization',
    'mfaCode',
    'cardNumber',
    'cvv',
    'iban',
    'accountNumber',
    'nationalId',
    'salary',
    'commissionAmount',
    'balance',
    'connectionString',
    'privateKey',
  ])('redacts %s instead of copying the value', (key) => {
    const secret = 'super-secret-value-0987654321';
    const summary = buildChangeSummary({ [key]: 'old-secret-value' }, { [key]: secret });
    expect(summary).toEqual([{ path: key, from: REDACTED, to: REDACTED }]);
    expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it('redacts sensitive keys at any depth, and caller-marked paths', () => {
    const nested = buildChangeSummary(
      { user: { credentials: { password: 'a' } } },
      { user: { credentials: { password: 'b' } } },
    );
    expect(nested).toEqual([{ path: 'user.credentials.password', from: REDACTED, to: REDACTED }]);

    const marked = buildChangeSummary(
      { note: 'before' },
      { note: 'after' },
      { protectedPaths: ['note'] },
    );
    expect(marked).toEqual([{ path: 'note', from: REDACTED, to: REDACTED }]);
  });

  it('describes large and structured values instead of copying them', () => {
    const long = 'x'.repeat(500);
    expect(summarizeValue(long, 'note')).toBe('[string length=500]');
    expect(summarizeValue({ a: 1, b: 2 }, 'note')).toBe('[object keys=2]');
    expect(
      summarizeValue(
        Array.from({ length: 40 }, (_, i) => i),
        'note',
      ),
    ).toBe('[array length=40]');
    expect(summarizeValue(['a', 'b'], 'note')).toBe('a,b');
    expect(summarizeValue(null, 'note')).toBe('(null)');
    expect(summarizeValue(undefined, 'note')).toBe('(absent)');
    expect(summarizeValue(new Date('2026-09-21T10:00:00.000Z'), 'when')).toBe(
      '2026-09-21T10:00:00.000Z',
    );
  });

  it('never stores a whole request body: an unchanged large payload produces no entry', () => {
    const body = { note: 'x'.repeat(1000), password: 'secret' };
    expect(buildChangeSummary(body, body)).toEqual([]);
  });

  it('caps the number of reported paths', () => {
    const before = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`f${i}`, i]));
    const after = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`f${i}`, i + 1]));
    expect(buildChangeSummary(before, after)).toHaveLength(200);
  });
});
