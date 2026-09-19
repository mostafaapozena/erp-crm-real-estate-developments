import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOB_OPTIONS,
  MAX_ATTEMPTS,
  deadLetterRecord,
  envelope,
  idempotentJobId,
  isExhausted,
} from './jobs';

describe('job options (PLAT-016)', () => {
  it('retry a bounded number of times with exponential backoff and keep failures', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(MAX_ATTEMPTS);
    expect(DEFAULT_JOB_OPTIONS.backoff).toMatchObject({ type: 'exponential' });
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });

  it('dead-letters only once every attempt is used', () => {
    expect(isExhausted({ attemptsMade: 4, opts: { attempts: 5 } })).toBe(false);
    expect(isExhausted({ attemptsMade: 5, opts: { attempts: 5 } })).toBe(true);
  });
});

describe('idempotent job IDs (INTEGRATION-006)', () => {
  it('are deterministic for the same logical operation', () => {
    expect(idempotentJobId('reminder', 'inst-1', '15d')).toBe(
      idempotentJobId('reminder', 'inst-1', '15d'),
    );
  });

  it('differ for different operations or keys, including ambiguous concatenations', () => {
    expect(idempotentJobId('reminder', 'inst-1', '15d')).not.toBe(
      idempotentJobId('reminder', 'inst-1', '7d'),
    );
    expect(idempotentJobId('reminder', 'ab', 'c')).not.toBe(idempotentJobId('reminder', 'a', 'bc'));
  });

  it('are safe for BullMQ and carry no raw key material', () => {
    const id = idempotentJobId('reminder', 'customer-phone-201001234567');
    expect(id).not.toContain(':');
    expect(id).not.toContain('201001234567');
    expect(Number.isInteger(Number(id))).toBe(false);
  });

  it('reject malformed input', () => {
    expect(() => idempotentJobId('Bad Op', 'x')).toThrow('INVALID_JOB_KEY');
    expect(() => idempotentJobId('op')).toThrow('INVALID_JOB_KEY');
    expect(() => idempotentJobId('op', '')).toThrow('INVALID_JOB_KEY');
  });
});

describe('correlation and dead letters (PLAT-007)', () => {
  it('carry the correlation ID and never the payload', () => {
    const data = envelope({ phone: '+201001234567', amount: '100.00' }, 'corr-12345678');
    const record = deadLetterRecord(
      'alola-system',
      { id: 'j1', name: 'send', attemptsMade: 5, data },
      'provider timeout',
    );
    expect(record.correlationId).toBe('corr-12345678');
    expect(JSON.stringify(record)).not.toContain('201001234567');
    expect(JSON.stringify(record)).not.toContain('100.00');
  });
});
