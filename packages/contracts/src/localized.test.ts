import { describe, expect, it } from 'vitest';
import { ErrorResponseSchema } from './errors';
import { LocalizedLabelSchema } from './localized';

describe('localized labels (I18N-009)', () => {
  it('requires both Arabic and English', () => {
    expect(LocalizedLabelSchema.safeParse({ ar: 'محجوزة', en: 'Reserved' }).success).toBe(true);
    expect(LocalizedLabelSchema.safeParse({ ar: 'محجوزة' }).success).toBe(false);
    expect(LocalizedLabelSchema.safeParse({ en: 'Reserved' }).success).toBe(false);
  });

  it('rejects blank values and unknown keys', () => {
    expect(LocalizedLabelSchema.safeParse({ ar: '  ', en: 'Reserved' }).success).toBe(false);
    expect(LocalizedLabelSchema.safeParse({ ar: 'أ', en: 'A', fr: 'A' }).success).toBe(false);
  });
});

describe('error responses (PLAT-008, I18N-008)', () => {
  it('carry a stable code, never free text', () => {
    expect(
      ErrorResponseSchema.safeParse({ error: { code: 'NOT_FOUND', correlationId: 'abc' } }).success,
    ).toBe(true);
    expect(
      ErrorResponseSchema.safeParse({ error: { code: 'Something broke', correlationId: 'abc' } })
        .success,
    ).toBe(false);
  });
});
